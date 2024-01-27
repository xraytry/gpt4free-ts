import { Chat, ChatOptions, ChatRequest, ModelType, Site } from '../base';
import { Pool } from '../../utils/pool';
import { Child } from './child';
import {
  Account,
  AIAction,
  AIActionType,
  ComponentLabelMap,
  getProgress,
} from './define';
import { Config } from '../../utils/config';
import { v4 } from 'uuid';
import {
  ComError,
  downloadAndUploadCDN,
  Event,
  EventStream,
  extractJSON,
  MessageData,
  ThroughEventStream,
} from '../../utils';
import { chatModel } from '../index';
import { clearInterval } from 'timers';

export class Midjourney extends Chat {
  private pool = new Pool<Account, Child>(
    this.options?.name || '',
    () => Config.config.midjourney.size,
    (info, options) => {
      return new Child(this.options?.name || '', info, options);
    },
    (info) => {
      if (!info.token) {
        return false;
      }
      if (!info.server_id) {
        return false;
      }
      if (!info.channel_id) {
        return false;
      }
      return true;
    },
    {
      delay: 3000,
      serial: () => Config.config.midjourney.serial,
      preHandleAllInfos: async (allInfos) => {
        const result: Account[] = [];
        for (const info of Config.config.midjourney.accounts) {
          result.push({
            id: v4(),
            token: info.token,
            server_id: info.server_id,
            channel_id: info.channel_id,
          } as Account);
        }
        return result;
      },
    },
  );

  constructor(options?: ChatOptions) {
    super(options);
  }

  support(model: ModelType): number {
    switch (model) {
      case ModelType.MJChat:
        return 28000;
      default:
        return 0;
    }
  }

  async doComponents(
    action: AIAction,
    child: Child,
    stream: EventStream,
    onEnd: () => void,
  ) {
    let itl: NodeJS.Timeout;
    if (!action.component_type || !action.message_id || !action.custom_id) {
      stream.write(Event.message, { content: 'Invalid component action' });
      stream.write(Event.done, { content: '' });
      stream.end();
      onEnd();
      return;
    }
    await child.doComponent(
      action.message_id,
      {
        component_type: action.component_type,
        custom_id: action.custom_id,
      },
      {
        onStart: (e) => {
          stream.write(Event.message, { content: '> 开始绘制' });
          itl = setInterval(() => {
            stream.write(Event.message, { content: '.' });
          }, 3000);
        },
        onUpdate: async (e) => {
          if (e.attachments[0]?.url) {
            stream.write(Event.message, {
              content: `[${getProgress(
                e.content,
              )}%](${await downloadAndUploadCDN(e.attachments[0]?.url)})`,
            });
          }
        },
        onEnd: async (e) => {
          clearInterval(itl);
          const url = await downloadAndUploadCDN(e.attachments[0]?.url);
          stream.write(Event.message, {
            content: `[100%](${url})\n\n`,
          });
          stream.write(Event.message, {
            content: `![${action.prompt}](${url})\n[⏬下载](${url.replace(
              '/cdn/',
              '/cdn/download/',
            )})\n\n`,
          });
          const components = e.components;
          if (components?.length) {
            stream.write(Event.message, {
              content: `> message_id: \`${e.id}\`\n\n`,
            });
            stream.write(Event.message, {
              content: `|name|label|type|custom_id|\n|---|---|---|---|\n`,
            });
            for (const v of components) {
              if (v.type === 1) {
                for (const b of v.components) {
                  const label = b.label || b.emoji?.name;
                  if (b.type === 2 && label && ComponentLabelMap[label]) {
                    b.name = ComponentLabelMap[label];
                    stream.write(Event.message, {
                      content: `|${b.name}|${label}|${b.type}|${b.custom_id}|\n`,
                    });
                  }
                }
              }
            }
          }
          stream.write(Event.done, { content: '' });
          stream.end();
          onEnd();
        },
        onError: (e) => {
          clearInterval(itl);
          stream.write(Event.message, {
            content: e.message,
          });
          stream.write(Event.done, { content: '' });
          stream.end();
        },
      },
    );
  }

  async imagine(
    action: AIAction,
    child: Child,
    stream: EventStream,
    onEnd: () => void,
  ) {
    let itl: NodeJS.Timeout;
    if (!action.prompt) {
      stream.write(Event.message, { content: 'Generate prompt failed' });
      stream.write(Event.done, { content: '' });
      stream.end();
      onEnd();
      return;
    }
    await child.imagine(action.prompt!, {
      onStart: (e) => {
        stream.write(Event.message, { content: '> 开始绘制' });
        itl = setInterval(() => {
          stream.write(Event.message, { content: '.' });
        }, 3000);
      },
      onUpdate: async (e) => {
        if (e.attachments[0]?.url) {
          stream.write(Event.message, {
            content: `[${getProgress(e.content)}%](${await downloadAndUploadCDN(
              e.attachments[0]?.url,
            )})`,
          });
        }
      },
      onEnd: async (e) => {
        clearInterval(itl);
        const url = await downloadAndUploadCDN(e.attachments[0]?.url);
        stream.write(Event.message, {
          content: `[100%](${url})\n\n`,
        });
        stream.write(Event.message, {
          content: `![${action.prompt}](${url})\n[⏬下载](${url.replace(
            '/cdn/',
            '/cdn/download/',
          )})\n\n`,
        });
        const components = e.components;
        if (components?.length) {
          stream.write(Event.message, {
            content: `> This message contains 4 images in one, contains such action components \n\n > message_id: \`${e.id}\`\n\n`,
          });
          stream.write(Event.message, {
            content: `|name|label|type|custom_id|\n|---|---|---|---|\n`,
          });
          for (const v of components) {
            if (v.type === 1) {
              for (const b of v.components) {
                const label = b.label || b.emoji?.name;
                if (b.type === 2 && label && ComponentLabelMap[label]) {
                  b.name = ComponentLabelMap[label];
                  stream.write(Event.message, {
                    content: `|${b.name}|${label}|${b.type}|${b.custom_id}|\n`,
                  });
                }
              }
            }
          }
        }
        stream.write(Event.message, {
          content: '\n **接下来你可以直接对我说命令，例如：帮我放大第一张图**',
        });
        stream.write(Event.done, { content: '' });
        stream.end();
        onEnd();
      },
      onError: (e) => {
        clearInterval(itl);
        stream.write(Event.message, {
          content: e.message,
        });
        stream.write(Event.done, { content: '' });
        stream.end();
      },
    });
  }

  async blend(
    action: AIAction,
    child: Child,
    stream: EventStream,
    onEnd: () => void,
  ) {
    let itl: NodeJS.Timeout;
    if (
      !action.image_urls?.length ||
      action.image_urls.length < 2 ||
      action.image_urls.length > 5
    ) {
      stream.write(Event.message, {
        content: 'Image urls length should between [2,5]',
      });
      stream.write(Event.done, { content: '' });
      stream.end();
      onEnd();
      return;
    }
    await child.blend(action.image_urls!, {
      dimensions: action.dimensions,
      onStart: (e) => {
        stream.write(Event.message, { content: '> 开始绘制' });
        itl = setInterval(() => {
          stream.write(Event.message, { content: '.' });
        }, 3000);
      },
      onUpdate: async (e) => {
        if (e.attachments[0]?.url) {
          stream.write(Event.message, {
            content: `[${getProgress(e.content)}%](${await downloadAndUploadCDN(
              e.attachments[0]?.url,
            )})`,
          });
        }
      },
      onEnd: async (e) => {
        clearInterval(itl);
        const url = await downloadAndUploadCDN(e.attachments[0]?.url);
        stream.write(Event.message, {
          content: `[100%](${url})\n\n`,
        });
        stream.write(Event.message, {
          content: `![${action.prompt}](${url})\n[⏬下载](${url.replace(
            '/cdn/',
            '/cdn/download/',
          )})\n\n`,
        });
        const components = e.components;
        if (components?.length) {
          stream.write(Event.message, {
            content: `> This message contains 4 images in one, contains such action components \n\n > message_id: \`${e.id}\`\n\n`,
          });
          stream.write(Event.message, {
            content: `|name|label|type|custom_id|\n|---|---|---|---|\n`,
          });
          for (const v of components) {
            if (v.type === 1) {
              for (const b of v.components) {
                const label = b.label || b.emoji?.name;
                if (b.type === 2 && label && ComponentLabelMap[label]) {
                  b.name = ComponentLabelMap[label];
                  stream.write(Event.message, {
                    content: `|${b.name}|${label}|${b.type}|${b.custom_id}|\n`,
                  });
                }
              }
            }
          }
        }
        stream.write(Event.message, {
          content: '\n **接下来你可以直接对我说命令，例如：帮我放大第一张图**',
        });
        stream.write(Event.done, { content: '' });
        stream.end();
        onEnd();
      },
      onError: (e) => {
        clearInterval(itl);
        stream.write(Event.message, {
          content: e.message,
        });
        stream.write(Event.done, { content: '' });
        stream.end();
      },
    });
  }

  async askStream(req: ChatRequest, stream: EventStream): Promise<void> {
    const child = await this.pool.pop();
    try {
      const auto = chatModel.get(Site.Auto);
      let old = '';
      const pt = new ThroughEventStream(
        (event, data) => {
          stream.write(event, data);
          if ((data as MessageData).content) {
            old += (data as MessageData).content;
          }
        },
        async () => {
          try {
            stream.write(Event.message, { content: '\n\n' });
            const action = extractJSON<AIAction>(old);
            if (!action) {
              stream.write(Event.message, {
                content: 'Generate action failed',
              });
              stream.write(Event.done, { content: '' });
              stream.end();
              return;
            }
            switch (action?.type) {
              case AIActionType.Imagine:
                await this.imagine(action, child, stream, () =>
                  child.release(),
                );
                return;
              case AIActionType.Component:
                await this.doComponents(action, child, stream, () =>
                  child.release(),
                );
                return;
              case AIActionType.Blend:
                await this.blend(action, child, stream, () => child.release());
                return;
              default:
                stream.write(Event.done, { content: '' });
                stream.end();
                child.release();
                break;
            }
          } catch (e: any) {
            stream.write(Event.error, { error: e.message });
            stream.write(Event.done, { content: '' });
            stream.end();
          }
        },
      );
      await auto?.askStream(
        { ...req, model: ModelType.GPT4Gizmo, gizmo_id: 'g-x6pzO1Y0U' } as any,
        pt,
      );
    } catch (e: any) {
      child.release();
      throw new ComError(e.message);
    }
  }
}
