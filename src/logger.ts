import { createLogger, format, transports as winstonTransports } from 'winston';
import * as Transport from 'winston-transport';
import kleur from 'kleur';

function colorizeByLevel(level: string, text: string): string {
  const levelMap: Record<string, string> = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    debug: 'magenta',
  };

  return kleur[
    (levelMap[level] as 'red' | 'yellow' | 'green' | 'magenta') ?? 'green'
  ](text);
}

const { combine, timestamp, printf } = format;

//? colorize logs for pretty look in console
const consoleFormat = printf(({ level, message, label, timestamp }) => {
  const spaces = ' '.repeat(7 - level.length);

  message = colorizeByLevel(level, message as string);
  level = colorizeByLevel(level, level.toUpperCase());

  return `${timestamp} ${spaces}${level} ${kleur.yellow(
    `[${label}]`,
  )} ${message}`;
});

//? colors are not good for files
const filesFormat = printf(({ level, message, label, timestamp }) => {
  const spaces = ' '.repeat(7 - level.length);

  return `${timestamp} ${spaces}${level} [${label}] ${message}`;
});

const transports: Transport[] = [
  new winstonTransports.File({ filename: 'error.log', level: 'error' }),
  new winstonTransports.File({ filename: 'info.log', level: 'info' }),
  new winstonTransports.File({
    filename: 'combined.log',
    maxFiles: 2,
    maxsize: 1048576, // 1MB
    tailable: true,
  }), // as combined file is gonna get big, logs rotation should be enabled for that
  new winstonTransports.Console({
    format: combine(timestamp(), consoleFormat),
  }),
];

const logger = createLogger({
  level: 'debug',
  format: combine(timestamp(), filesFormat),
  transports,
});

export default logger;
