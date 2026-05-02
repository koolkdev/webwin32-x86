import { deepStrictEqual, throws } from "node:assert";
import { test } from "node:test";

import { buildIr } from "../build/builder.js";

test("builder appends implicit next for fallthrough templates", () => {
  deepStrictEqual(buildIr(() => {}), [{ op: "next" }]);
});

test("builder rejects ops after a terminator", () => {
  throws(
    () =>
      buildIr((s) => {
        s.jump(s.get32(s.operand(0)));
        s.get32(s.operand(1));
      }),
    /cannot emit get32 after IR terminator/
  );
});
