export interface MojoSourceValueFunction {
  readonly modulePath: readonly string[];
  readonly name: string;
}

export function mojoSourceValueFunctionEquals(
  left: MojoSourceValueFunction,
  right: MojoSourceValueFunction,
): boolean {
  return left.name === right.name && left.modulePath.length === right.modulePath.length &&
    left.modulePath.every((segment, index) => segment === right.modulePath[index]);
}
