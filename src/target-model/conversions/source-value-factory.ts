export interface MojoSourceValueFactory {
  readonly modulePath: readonly string[];
  readonly name: string;
}

export function mojoSourceValueFactoryEquals(
  left: MojoSourceValueFactory,
  right: MojoSourceValueFactory,
): boolean {
  return left.name === right.name && left.modulePath.length === right.modulePath.length &&
    left.modulePath.every((segment, index) => segment === right.modulePath[index]);
}
