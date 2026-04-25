import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import z from 'zod';

const config = z
  .object({
    telegram: z.object({
      webhook: z.object({
        enabled: z.boolean().default(true),
        port: z.number().min(0).max(65535).default(3000),
        endpoint: z.url().default('http://app:3000'), //? assuming that you're running bot in compose environment
      }),
      whitelist: z.array(z.string()).optional(),
      botApi: z.object({
        localMode: z.boolean().default(true), //? using self-hosted local bot api instead of global telegram boy api to bypass 20 MB download size limit
        baseUrl: z.url().default('http://telegram-bot-api:8081'), //? assuming that you're running bot in compose environment
      }),
    }),
    limits: z.object({
      downloads: z
        .number()
        .default(500)
        .transform((val) => val * 1024 * 1024), //? it's easier to work with bytes rather than MB in code
      chunks: z
        .union([
          z.number(),
          z.object({
            bale: z.number(),
            rubika: z.number(),
          }),
        ])
        .default(20)
        .transform((val) =>
          typeof val === 'number' ? { bale: val, rubika: val } : val,
        ),
    }),
  })
  .parse(
    parse(
      readFileSync(join(import.meta.dirname, '..', 'config.yaml'), 'utf-8'),
    ),
  );

const env = z
  .object({
    TELEGRAM_API_ID: z
      .string()
      .optional()
      .refine((val) => (config.telegram.botApi.localMode ? !!val : true), {
        error:
          'TELEGRAM_API_ID is required in env when you are using local mode',
      }),
    TELEGRAM_API_HASH: z
      .string()
      .optional()
      .refine((val) => (config.telegram.botApi.localMode ? !!val : true), {
        error:
          'TELEGRAM_API_HASH is required in env when you are using local mode',
      }),
    TELEGRAM_BOT_TOKEN: z.string(),
    BALE_BOT_TOKEN: z.string(),
    RUBIKA_BOT_TOKEN: z.string(),
  })
  .parse(process.env);

export default { ...config, env };
