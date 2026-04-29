import { deepStrictEqual, throws } from "node:assert";
import { test } from "node:test";

import { buildSir } from "../builder.js";

test("builder appends implicit next for fallthrough templates", () => {
  deepStrictEqual(buildSir(() => {}), [{ op: "next" }]);
});

test("builder rejects ops after a terminator", () => {
  throws(
    () =>
      buildSir((s) => {
        s.jump(s.get32("target"));
        s.get32("src");
      }),
    /cannot emit get32 after SIR terminator/
  );
});
