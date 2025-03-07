import { Color, LogLevel, OgmaLog, OgmaStream, OgmaWritableLevel } from '@ogma/common';
import { style, Styler } from '@ogma/styler';
import { hostname } from 'os';

import { OgmaDefaults, OgmaOptions, PrintMessageOptions } from '../interfaces';
import { OgmaPrintOptions } from '../interfaces/ogma-print-options';
import { colorize, isNil } from '../utils';

/**
 * The main logger instance
 */
export class Ogma {
  private options: OgmaOptions;
  private pid: number;
  private hostname: string;
  private styler: Styler;

  /**
   * An alias for `ogma.verbose`. `FINE` is what is printed as the log level
   */
  public fine = this.verbose;
  /**
   * An alias for `ogma.info`. `INFO` is what is printed as the log level
   */
  public log = this.info;

  constructor(options?: Partial<OgmaOptions>) {
    if (options?.logLevel) {
      options.logLevel = options.logLevel.toUpperCase() as keyof typeof LogLevel;
    }
    options &&
      Object.keys(options)
        .filter((key) => isNil(options[key]))
        .forEach((key) => delete options[key]);
    this.options = { ...OgmaDefaults, ...(options as OgmaOptions) };
    this.pid = process.pid;
    this.hostname = hostname();
    if (options?.logLevel && LogLevel[options.logLevel] === undefined) {
      this.options.logLevel = OgmaDefaults.logLevel;
      this.warn(
        `Ogma logLevel was set to ${options.logLevel} which does not match a defined logLevel. Falling back to default instead.`,
      );
    }
    if (!this.options.stream.getColorDepth) {
      this.setStreamColorDepth();
    }
    this.styler = style.child(this.options.stream as Pick<OgmaStream, 'getColorDepth'>);
  }

  private setStreamColorDepth(): void {
    let colorDepthVal: number;
    if (this.options.color) {
      colorDepthVal = 4;
    }
    if (this.options.color === false) {
      colorDepthVal = 1;
    }
    if (!colorDepthVal && this.options.stream !== process.stdout && process.stdout.getColorDepth) {
      colorDepthVal = process.stdout.getColorDepth();
    }
    this.options.stream.getColorDepth = () => colorDepthVal ?? 1;
  }

  private printMessage(message: any, options: PrintMessageOptions): void {
    if (options.level < LogLevel[this.options.logLevel]) {
      return;
    }
    let logString = '';
    if (this.options.json) {
      logString = this.formatJSON(message, options);
    } else {
      logString = this.formatStream(message, options);
    }
    this.options.stream.write(`${logString}\n`);
    if (this.options.verbose && !this.options.json) {
      const {
        context: _context,
        application: _application,
        correlationId: _correlationId,
        level: _level,
        formattedLevel: _formattedLevel,
        ...meta
      } = options;
      this.options.stream.write(this.formatStream(meta, options));
    }
  }

  private circularReplacer(): (key: string, value: any) => string {
    const seen = new WeakSet();
    return (key: string, value: any): string => {
      if (typeof value === 'symbol') {
        return this.wrapInBrackets(value.toString());
      }
      if (typeof value === 'function') {
        return this.wrapInBrackets(`Function: ${value.name || '(anonymous)'}`);
      }
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return this.wrapInBrackets('Circular');
        }
        seen.add(value);
      }
      if (this.options.masks.includes(key)) {
        return '*'.repeat(value.toString().length);
      }
      return value;
    };
  }

  private toColor(level: LogLevel, color: Color): string {
    const levelString = this.wrapInBrackets(this.options.levelMap[LogLevel[level]]).padEnd(7);
    return colorize(levelString, color, this.styler, this.options.color);
  }

  private wrapInBrackets(valueToBeWrapper: string): string {
    return `[${valueToBeWrapper}]`;
  }

  private formatJSON(
    message: any,
    { application = '', correlationId = '', context = '', level, ...meta }: PrintMessageOptions,
  ): string {
    let json: Partial<OgmaLog> = {
      time: this.getTimestamp(),
    };
    delete meta.formattedLevel;
    const mappedLevel = this.options.levelMap[LogLevel[level] as keyof typeof LogLevel];

    if (this.options.logHostname) {
      json.hostname = this.hostname;
    }

    if (this.options.logApplication) {
      json.application = application || this.options.application || undefined;
    }

    if (this.options.logPid) {
      json.pid = this.pid;
    }

    json.correlationId = correlationId;
    json.context = context || this.options.context || undefined;
    json.level = mappedLevel;
    json.ool = LogLevel[level] as OgmaWritableLevel;
    if (this.options.levelKey) {
      json[this.options.levelKey] = mappedLevel;
    }
    if (typeof message === 'object') {
      json = { ...json, ...message };
      // delete json.message;
    } else {
      json.message = message;
    }
    if (meta && Object.keys(meta).length) {
      json.meta = meta;
    }
    return JSON.stringify(json, this.circularReplacer());
  }

  private formatStream(
    message: any,
    { application = '', correlationId = '', formattedLevel, context = '' }: PrintMessageOptions,
  ): string {
    if (typeof message === 'object' && !(message instanceof Error)) {
      message = '\n' + JSON.stringify(message, this.circularReplacer(), 2);
    }
    const { logHostname, logApplication, logPid } = this.options;

    context = this.toStreamColor(context || this.options.context, Color.CYAN);
    correlationId &&= this.wrapInBrackets(correlationId);

    const timestamp = this.wrapInBrackets(this.getTimestamp());
    const hostname = logHostname ? this.toStreamColor(this.hostname, Color.MAGENTA) + ' ' : '';

    const applicationName = logApplication
      ? this.toStreamColor(application || this.options.application, Color.YELLOW) + ' '
      : '';

    const pid = logPid ? this.wrapInBrackets(this.pid.toString()) + ' ' : '';

    return `${timestamp} ${formattedLevel} ${hostname}${applicationName}${pid}${correlationId} ${context} ${message}`;
  }

  private toStreamColor(value: string, color: Color): string {
    if (!value) {
      return '';
    }
    return colorize(this.wrapInBrackets(value), color, this.styler, this.options.color);
  }

  private getTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Make a log at the least important level possible. Could be fun for Easter Eggs if you like adding those in.
   * Prints the level in a magenta color
   * @param message what to log
   * @param meta any additional information you want to add
   */
  public silly(message: any, meta?: OgmaPrintOptions): void {
    this.printMessage(message, {
      level: LogLevel.SILLY,
      formattedLevel: this.toColor(LogLevel.SILLY, Color.MAGENTA),
      ...meta,
    });
  }

  /**
   * Make a log at the `fine` or `verbose` level. Great for adding in some nitty gritty details.
   * Prints the level in a green color
   * @param message what to log
   * @param meta any additional information you want to add
   */
  public verbose(message: any, meta?: OgmaPrintOptions): void {
    this.printMessage(message, {
      level: LogLevel.VERBOSE,
      formattedLevel: this.toColor(LogLevel.VERBOSE, Color.GREEN),
      ...meta,
    });
  }

  /**
   * Make a log at the `debug` level. Good for quick messages while debugging that shouldn't make it to production.
   * Prints the level in a blue color
   * @param message what to log
   * @param meta any additional information you want to add
   */
  public debug(message: any, meta?: OgmaPrintOptions): void {
    this.printMessage(message, {
      level: LogLevel.DEBUG,
      formattedLevel: this.toColor(LogLevel.DEBUG, Color.BLUE),
      ...meta,
    });
  }

  /**
   * Makes a log at the `info` level. This is where most of the logging is done generally.
   * Prints the level in a cyan color
   * @param message what to log
   * @param meta any additional information you want to add
   */
  public info(message: any, meta?: OgmaPrintOptions): void {
    this.printMessage(message, {
      level: LogLevel.INFO,
      formattedLevel: this.toColor(LogLevel.INFO, Color.CYAN),
      ...meta,
    });
  }

  /**
   * Makes a log at the `info` level. This is where most of the logging is done generally.
   * Prints the level in a cyan color
   * @param message what to log
   * @param meta any additional information you want to add
   */
  public warn(message: any, meta?: OgmaPrintOptions): void {
    this.printMessage(message, {
      level: LogLevel.WARN,
      formattedLevel: this.toColor(LogLevel.WARN, Color.YELLOW),
      ...meta,
    });
  }

  /**
   * Makes a log at the `info` level. This is where most of the logging is done generally.
   * Prints the level in a cyan color
   * @param message what to log
   * @param meta any additional information you want to add
   */
  public error(message: any, meta?: OgmaPrintOptions): void {
    this.printMessage(message, {
      level: LogLevel.ERROR,
      formattedLevel: this.toColor(LogLevel.ERROR, Color.RED),
      ...meta,
    });
  }

  /**
   * Makes a log at the `fatal` level. This is for mission critical problems. Usually if a `fatal` log is made, someone should be getting a call at 3AM.
   * Prints the level in a red background with white underline and lettering
   * Prints the level in a cyan color
   * @param message what to log
   * @param meta any additional information you want to add
   */
  public fatal(message: any, meta?: OgmaPrintOptions): void {
    this.printMessage(message, {
      level: LogLevel.FATAL,
      formattedLevel: this.styler.redBg.white.underline.apply(
        this.wrapInBrackets(LogLevel[LogLevel.FATAL]),
      ),
      ...meta,
    });
  }

  /**
   * Splits up the error between it's name, message, and stack.
   * The name is logged at the `error` level,
   * the message at the `warn` level,
   * and the stack trace at the `verbose` level.
   * @param error The error to print
   * @param meta any additional information you want to add
   */
  public printError(error: Error, meta?: OgmaPrintOptions): void {
    this.error(error.name, meta);
    this.warn(error.message, meta);
    this.verbose('\n' + error.stack, meta);
  }
}
