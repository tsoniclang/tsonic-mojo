export const retainedFactorySource = `
export function retained(seed: number): (step: number) => Promise<number> {
  let total = seed;
  return async (step: number): Promise<number> => { total += step; return total; };
}
`;

export const ownedCallbackSource = `${retainedFactorySource}
export async function run(): Promise<boolean> {
  const next = retained(10);
  const first = await next(2);
  const second = await next(3);
  return first === 12 && second === 15;
}
`;

export const defaultArgumentsFactorySource = `
export function create(prefix: string): (head?: string, ...tail: string[]) => Promise<string> {
  return async (head: string = "default", ...tail: string[]): Promise<string> => tail.length === 2 ? prefix + head : prefix;
}
`;

export const throwingFactorySource = `
export function rejecting(): (step: number) => Promise<number> {
  return async (step: number): Promise<number> => {
    if (step < 0) throw new Error("negative step");
    return step;
  };
}
`;

export const emptyFactorySource = `
export function empty(): () => Promise<number> { return async (): Promise<number> => 11; }
`;

export const declarationFactorySource = `
async function load(value: string): Promise<string> { return value; }
class Loader { static async load(value: string): Promise<string> { return value; } }
export function callback(): (value: string) => Promise<string> { return load; }
export function method(): (value: string) => Promise<string> { return Loader.load; }
export function same(): boolean { return load === load && Loader.load === Loader.load; }
`;
