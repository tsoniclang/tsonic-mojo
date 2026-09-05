import { jsStandardSourceProfileDeclarations } from "@tsonic/js-source-profile";
import {
  targetSourceProfileDeclaration,
  typescriptNoLibUtilityDeclarations,
} from "@tsonic/target-api/provider";
import type { TargetSourceProfileContributions } from "@tsonic/target-api/provider";
import { mojoTargetId } from "../../target-model/identities/target.js";

export const mojoSourceProfileOwnerId = mojoTargetId;
export const mojoJsSourceProfileOwnerId = "js";

const commonDeclarations = `
type PropertyKey = string | number | symbol;

interface Object {}
interface Function {}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments {
  readonly length: number;
  [index: number]: unknown;
}
interface Boolean {}
interface Number {}
interface String {
  readonly length: number;
}
interface RegExp {}

interface Error {
  name: string;
  message: string;
  stack?: string;
}
interface ErrorConstructor {
  new (message?: string): Error;
  (message?: string): Error;
}
declare var Error: ErrorConstructor;

interface PromiseLike<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1) | null,
    onrejected?: ((reason: unknown) => TResult2) | null
  ): PromiseLike<TResult1 | TResult2>;
}
interface Promise<T> extends PromiseLike<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1) | null,
    onrejected?: ((reason: unknown) => TResult2) | null
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(onrejected?: ((reason: unknown) => TResult) | null): Promise<T | TResult>;
}
interface PromiseConstructor {
  new <T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: unknown) => void) => void): Promise<T>;
  resolve<T>(value: T | PromiseLike<T>): Promise<T>;
  reject<T = never>(reason?: unknown): Promise<T>;
  all<T extends readonly unknown[]>(values: T): Promise<{ [K in keyof T]: Awaited<T[K]> }>;
}
declare var Promise: PromiseConstructor;

interface Symbol {
  readonly description: string | undefined;
  toString(): string;
  valueOf(): symbol;
}
interface SymbolConstructor {
  readonly iterator: unique symbol;
  readonly asyncIterator: unique symbol;
  readonly dispose: unique symbol;
  readonly asyncDispose: unique symbol;
}
declare var Symbol: SymbolConstructor;

interface IteratorYieldResult<TYield> { done?: false; value: TYield; }
interface IteratorReturnResult<TReturn> { done: true; value: TReturn; }
type IteratorResult<T, TReturn = unknown> = IteratorYieldResult<T> | IteratorReturnResult<TReturn>;
interface Iterator<T, TReturn = unknown, TNext = unknown> {
  next(): IteratorResult<T, TReturn>;
  next(value: TNext): IteratorResult<T, TReturn>;
}
interface Iterable<T, TReturn = unknown, TNext = unknown> {
  [Symbol.iterator](): Iterator<T, TReturn, TNext>;
}
interface IterableIterator<T, TReturn = unknown, TNext = unknown>
  extends Iterator<T, TReturn, TNext>, Iterable<T, TReturn, TNext> {}
interface AsyncIterator<T, TReturn = unknown, TNext = unknown> {
  next(): Promise<IteratorResult<T, TReturn>>;
  next(value: TNext): Promise<IteratorResult<T, TReturn>>;
}
interface AsyncIterable<T, TReturn = unknown, TNext = unknown> {
  [Symbol.asyncIterator](): AsyncIterator<T, TReturn, TNext>;
}
interface AsyncIterableIterator<T, TReturn = unknown, TNext = unknown>
  extends AsyncIterator<T, TReturn, TNext>, AsyncIterable<T, TReturn, TNext> {}
interface Generator<T = unknown, TReturn = unknown, TNext = unknown>
  extends Iterator<T, TReturn, TNext> {
  return(value: TReturn): IteratorResult<T, TReturn>;
  throw(error: unknown): IteratorResult<T, TReturn>;
  [Symbol.iterator](): Generator<T, TReturn, TNext>;
}
interface AsyncGenerator<T = unknown, TReturn = unknown, TNext = unknown>
  extends AsyncIterator<T, TReturn, TNext> {
  return(value: TReturn): Promise<IteratorResult<T, TReturn>>;
  throw(error: unknown): Promise<IteratorResult<T, TReturn>>;
  [Symbol.asyncIterator](): AsyncGenerator<T, TReturn, TNext>;
}
interface Disposable { [Symbol.dispose](): void; }
interface AsyncDisposable { [Symbol.asyncDispose](): void | PromiseLike<void>; }

interface Array<T> extends Iterable<T> {
  length: number;
  [index: number]: T;
}
interface ReadonlyArray<T> extends Iterable<T> {
  readonly length: number;
  readonly [index: number]: T;
}

interface ReadonlyMap<K, V> extends Iterable<[K, V]> {
  readonly size: number;
  get(key: K): V | undefined;
  has(key: K): boolean;
  keys(): IterableIterator<K>;
  values(): IterableIterator<V>;
  entries(): IterableIterator<[K, V]>;
  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void): void;
}
interface Map<K, V> extends ReadonlyMap<K, V> {
  set(key: K, value: V): this;
  delete(key: K): boolean;
  clear(): void;
}
interface MapConstructor {
  new <K, V>(entries?: readonly (readonly [K, V])[] | Iterable<readonly [K, V]>): Map<K, V>;
}
declare var Map: MapConstructor;

interface ReadonlySet<T> extends Iterable<T> {
  readonly size: number;
  has(value: T): boolean;
  keys(): IterableIterator<T>;
  values(): IterableIterator<T>;
  entries(): IterableIterator<[T, T]>;
  forEach(callbackfn: (value: T, key: T, set: ReadonlySet<T>) => void): void;
}
interface Set<T> extends ReadonlySet<T> {
  add(value: T): this;
  delete(value: T): boolean;
  clear(): void;
}
interface SetConstructor {
  new <T>(values?: readonly T[] | Iterable<T>): Set<T>;
}
declare var Set: SetConstructor;
`.trim();

const jsCoreDeclarations = `
${commonDeclarations}

interface ObjectConstructor {
  keys(value: object): string[];
  values<T>(value: { [key: string]: T } | ArrayLike<T>): T[];
  entries<T>(value: { [key: string]: T } | ArrayLike<T>): [string, T][];
  assign<T extends object, U extends object>(target: T, source: U): T & U;
  hasOwn(value: object, key: PropertyKey): boolean;
  is(value: unknown, other: unknown): boolean;
}
declare var Object: ObjectConstructor;

interface Object {
  hasOwnProperty(key: PropertyKey): boolean;
  toString(): string;
}

interface Boolean {
  toString(): string;
  valueOf(): boolean;
}
interface BooleanConstructor {
  new (value?: unknown): Boolean;
  (value?: unknown): boolean;
}
declare var Boolean: BooleanConstructor;

interface Number {
  toString(radix?: number): string;
  valueOf(): number;
  toFixed(fractionDigits?: number): string;
  toExponential(fractionDigits?: number): string;
  toPrecision(precision?: number): string;
}
interface NumberConstructor {
  readonly MAX_VALUE: number;
  readonly MIN_VALUE: number;
  readonly NaN: number;
  readonly NEGATIVE_INFINITY: number;
  readonly POSITIVE_INFINITY: number;
  readonly MAX_SAFE_INTEGER: number;
  readonly MIN_SAFE_INTEGER: number;
  readonly EPSILON: number;
  new (value?: unknown): Number;
  (value?: unknown): number;
  isFinite(value: unknown): boolean;
  isInteger(value: unknown): boolean;
  isNaN(value: unknown): boolean;
  isSafeInteger(value: unknown): boolean;
  parseFloat(value: string): number;
  parseInt(value: string, radix?: number): number;
}
declare var Number: NumberConstructor;

declare function parseInt(value: string, radix?: number): number;
declare function parseFloat(value: string): number;
declare function isNaN(value: number): boolean;
declare function isFinite(value: number): boolean;
declare function encodeURIComponent(value: string): string;
declare function decodeURIComponent(value: string): string;

interface String {
  readonly length: number;
  readonly [index: number]: string;
  startsWith(value: string, position?: number): boolean;
  endsWith(value: string, endPosition?: number): boolean;
  includes(value: string, position?: number): boolean;
  trim(): string;
  trimStart(): string;
  trimEnd(): string;
  trimLeft(): string;
  trimRight(): string;
  toString(): string;
  valueOf(): string;
  charAt(index: number): string;
  charCodeAt(index: number): number;
  codePointAt(index: number): number | undefined;
  slice(start?: number, end?: number): string;
  substring(start: number, end?: number): string;
  substr(start: number, length?: number): string;
  indexOf(searchString: string, position?: number): number;
  lastIndexOf(searchString: string, position?: number): number;
  at(index: number): string | undefined;
  concat(...strings: string[]): string;
  repeat(count: number): string;
  padStart(maxLength: number, fillString?: string): string;
  padEnd(maxLength: number, fillString?: string): string;
  normalize(form?: UnicodeNormalizationForm): string;
  toLowerCase(): string;
  toUpperCase(): string;
  isWellFormed(): boolean;
  toWellFormed(): string;
}
type UnicodeNormalizationForm = "NFC" | "NFD" | "NFKC" | "NFKD";
interface StringConstructor {
  new (value?: unknown): String;
  (value?: unknown): string;
  fromCharCode(...codes: number[]): string;
  fromCodePoint(...codes: number[]): string;
}
declare var String: StringConstructor;

interface Array<T> extends Iterable<T> {
  length: number;
  push(...items: T[]): number;
  pop(): T | undefined;
  shift(): T | undefined;
  unshift(...items: T[]): number;
  slice(start?: number, end?: number): T[];
  splice(start: number, deleteCount?: number, ...items: T[]): T[];
  concat(...items: (T | readonly T[])[]): T[];
  join(separator?: string): string;
  at(index: number): T | undefined;
  includes(searchElement: T, fromIndex?: number): boolean;
  indexOf(searchElement: T, fromIndex?: number): number;
  lastIndexOf(searchElement: T, fromIndex?: number): number;
  reverse(): T[];
  sort(compareFn?: (left: T, right: T) => number): T[];
  fill(value: T, start?: number, end?: number): T[];
  copyWithin(target: number, start: number, end?: number): T[];
  forEach(callback: (value: T, index: number, array: T[]) => void): void;
  filter(callback: (value: T, index: number, array: T[]) => unknown): T[];
  find(callback: (value: T, index: number, array: T[]) => unknown): T | undefined;
  findIndex(callback: (value: T, index: number, array: T[]) => unknown): number;
  findLast(callback: (value: T, index: number, array: T[]) => unknown): T | undefined;
  findLastIndex(callback: (value: T, index: number, array: T[]) => unknown): number;
  some(callback: (value: T, index: number, array: T[]) => unknown): boolean;
  every(callback: (value: T, index: number, array: T[]) => unknown): boolean;
  map<U>(callback: (value: T, index: number, array: T[]) => U): U[];
  reduce(callback: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T;
  reduce(callback: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T;
  reduce<U>(callback: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U;
}
interface ReadonlyArray<T> extends Iterable<T> {
  readonly length: number;
  at(index: number): T | undefined;
  slice(start?: number, end?: number): T[];
  concat(...items: (T | readonly T[])[]): T[];
  join(separator?: string): string;
  includes(searchElement: T, fromIndex?: number): boolean;
  indexOf(searchElement: T, fromIndex?: number): number;
  lastIndexOf(searchElement: T, fromIndex?: number): number;
  forEach(callback: (value: T, index: number, array: readonly T[]) => void): void;
  filter(callback: (value: T, index: number, array: readonly T[]) => unknown): T[];
  find(callback: (value: T, index: number, array: readonly T[]) => unknown): T | undefined;
  findIndex(callback: (value: T, index: number, array: readonly T[]) => unknown): number;
  findLast(callback: (value: T, index: number, array: readonly T[]) => unknown): T | undefined;
  findLastIndex(callback: (value: T, index: number, array: readonly T[]) => unknown): number;
  some(callback: (value: T, index: number, array: readonly T[]) => unknown): boolean;
  every(callback: (value: T, index: number, array: readonly T[]) => unknown): boolean;
  map<U>(callback: (value: T, index: number, array: readonly T[]) => U): U[];
}
interface ArrayConstructor {
  new <T>(...items: T[]): T[];
  <T>(...items: T[]): T[];
  isArray(value: unknown): value is unknown[];
  from(arrayLike: string): string[];
  from<T>(value: ArrayLike<T> | Iterable<T>): T[];
  from<T, U>(value: ArrayLike<T> | Iterable<T>, mapfn: (value: T, index: number) => U): U[];
  of<T>(...items: T[]): T[];
}
declare var Array: ArrayConstructor;

interface ReadonlySet<T> {
  union(other: ReadonlySet<T>): Set<T>;
  intersection(other: ReadonlySet<T>): Set<T>;
  difference(other: ReadonlySet<T>): Set<T>;
  symmetricDifference(other: ReadonlySet<T>): Set<T>;
  isSubsetOf(other: ReadonlySet<T>): boolean;
  isSupersetOf(other: ReadonlySet<T>): boolean;
  isDisjointFrom(other: ReadonlySet<T>): boolean;
}

interface Date {
  getTime(): number;
  valueOf(): number;
  getUTCFullYear(): number;
  getUTCMonth(): number;
  getUTCDate(): number;
  getUTCDay(): number;
  getUTCHours(): number;
  getUTCMinutes(): number;
  getUTCSeconds(): number;
  getUTCMilliseconds(): number;
  setTime(time: number): number;
  setUTCMilliseconds(ms: number): number;
  setUTCSeconds(sec: number, ms?: number): number;
  setUTCMinutes(min: number, sec?: number, ms?: number): number;
  setUTCHours(hours: number, min?: number, sec?: number, ms?: number): number;
  setUTCDate(date: number): number;
  setUTCMonth(month: number, date?: number): number;
  setUTCFullYear(year: number, month?: number, date?: number): number;
  toISOString(): string;
  toUTCString(): string;
  toJSON(): string;
  toString(): string;
}
interface DateConstructor {
  new (): Date;
  new (value: number): Date;
  new (value: string): Date;
  now(): number;
  parse(value: string): number;
  UTC(year: number, monthIndex: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number): number;
}
declare var Date: DateConstructor;

interface JSON {
  parse(text: string): unknown;
  stringify(value: unknown, replacer?: ((key: string, value: unknown) => unknown) | null, space?: string | number): string | undefined;
  stringify(value: unknown, replacer?: readonly (string | number)[] | null, space?: string | number): string | undefined;
}
declare var JSON: JSON;

interface Math {
  readonly E: number;
  readonly LN2: number;
  readonly LN10: number;
  readonly LOG2E: number;
  readonly LOG10E: number;
  readonly PI: number;
  readonly SQRT1_2: number;
  readonly SQRT2: number;
  abs(x: number): number;
  acos(x: number): number;
  acosh(x: number): number;
  asin(x: number): number;
  asinh(x: number): number;
  atan(x: number): number;
  atanh(x: number): number;
  atan2(y: number, x: number): number;
  cbrt(x: number): number;
  floor(x: number): number;
  ceil(x: number): number;
  clz32(x: number): number;
  cos(x: number): number;
  cosh(x: number): number;
  exp(x: number): number;
  expm1(x: number): number;
  fround(x: number): number;
  hypot(...values: number[]): number;
  imul(x: number, y: number): number;
  log(x: number): number;
  log1p(x: number): number;
  log10(x: number): number;
  log2(x: number): number;
  trunc(x: number): number;
  round(x: number): number;
  max(...values: number[]): number;
  min(...values: number[]): number;
  pow(x: number, y: number): number;
  sign(x: number): number;
  sin(x: number): number;
  sinh(x: number): number;
  sqrt(x: number): number;
  tan(x: number): number;
  tanh(x: number): number;
  random(): number;
}
declare var Math: Math;

interface Console {
  log(...data: unknown[]): void;
  error(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  info(...data: unknown[]): void;
  debug(...data: unknown[]): void;
}
declare var console: Console;

${jsStandardSourceProfileDeclarations}
`.trim();

export function mojoNativeSourceProfileContributions(): TargetSourceProfileContributions {
  return Object.freeze({
    declarations: Object.freeze([
      targetSourceProfileDeclaration(
        "typescript-utilities.d.ts",
        typescriptNoLibUtilityDeclarations,
      ),
      targetSourceProfileDeclaration("mojo-globals.d.ts", commonDeclarations),
    ]),
  });
}

export function mojoJsSurfaceSourceProfileContributions(): TargetSourceProfileContributions {
  return Object.freeze({
    declarations: Object.freeze([
      targetSourceProfileDeclaration(
        "typescript-utilities.d.ts",
        typescriptNoLibUtilityDeclarations,
      ),
      targetSourceProfileDeclaration("js-globals.d.ts", jsCoreDeclarations),
    ]),
  });
}
