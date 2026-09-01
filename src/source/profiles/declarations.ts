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
interface String {}
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
}
declare var Promise: PromiseConstructor;

interface SymbolConstructor {
  readonly iterator: unique symbol;
  readonly asyncIterator: unique symbol;
}
declare var Symbol: SymbolConstructor;

interface IteratorYieldResult<TYield> { done?: false; value: TYield; }
interface IteratorReturnResult<TReturn> { done: true; value: TReturn; }
type IteratorResult<T, TReturn = unknown> = IteratorYieldResult<T> | IteratorReturnResult<TReturn>;
interface Iterator<T, TReturn = unknown, TNext = unknown> {
  next(value?: TNext): IteratorResult<T, TReturn>;
}
interface Iterable<T> { [Symbol.iterator](): Iterator<T>; }
interface IterableIterator<T> extends Iterator<T>, Iterable<T> {}

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
  values<T>(value: { [key: string]: T }): T[];
  entries<T>(value: { [key: string]: T }): [string, T][];
}
declare var Object: ObjectConstructor;

interface String {
  readonly length: number;
  readonly [index: number]: string;
  startsWith(value: string, position?: number): boolean;
  endsWith(value: string, endPosition?: number): boolean;
  includes(value: string, position?: number): boolean;
  trim(): string;
  slice(start?: number, end?: number): string;
  substring(start: number, end?: number): string;
  indexOf(searchString: string, position?: number): number;
  toLowerCase(): string;
  toUpperCase(): string;
}
interface StringConstructor {
  (value?: unknown): string;
  fromCharCode(...codes: number[]): string;
  fromCodePoint(...codes: number[]): string;
}
declare var String: StringConstructor;

interface Array<T> {
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
interface ReadonlyArray<T> {
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
  isArray(value: unknown): value is unknown[];
  from<T>(value: ArrayLike<T> | Iterable<T>): T[];
}
declare var Array: ArrayConstructor;

interface Console {
  log(...data: unknown[]): void;
  error(...data: unknown[]): void;
  warn(...data: unknown[]): void;
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
