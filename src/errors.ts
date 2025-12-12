export class PolyCoreError extends Error {
  override name = "PolyCoreError";
}

export class MissingDependencyError extends PolyCoreError {
  override name = "MissingDependencyError";
}

export class InvalidConfigError extends PolyCoreError {
  override name = "InvalidConfigError";
}

export class NotInitializedError extends PolyCoreError {
  override name = "NotInitializedError";
}
