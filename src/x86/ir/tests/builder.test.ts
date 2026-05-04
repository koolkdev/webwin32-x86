import { deepStrictEqual, throws } from "node:assert";
import { test } from "node:test";

import { buildIr } from "#x86/ir/build/builder.js";

test("builder appends implicit next for fallthrough templates", () => {
  deepStrictEqual(buildIr(() => {}), [{ op: "next" }]);
});

test("builder rejects ops after a terminator", () => {
  throws(
    () =>
      buildIr((s) => {
        s.jump(s.get(s.operand(0)));
        s.get(s.operand(1));
      }),
    /cannot emit get after IR terminator/
  );
});
