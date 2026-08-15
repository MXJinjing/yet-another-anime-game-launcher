export function assertValueDefined<V>(
  value: V
): asserts value is NonNullable<V> {
  if (value === null || value === undefined) {
    throw new Error("Assertation failed: value is either null or undefined.");
  }
}

export function arrayFind<T>(
  array: Array<T>,
  predict: (value: T) => boolean
): T {
  const ret = array.find(predict);
  if (ret === undefined) {
    throw new Error("Assertation failed: can not find element in array");
  }
  return ret;
}
