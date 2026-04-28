import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { rawX86FixtureFromJson, type RawX86Fixture, type RawX86FixtureJson } from "./raw-x86-fixture.js";

const fixtureIdPattern = /^[a-z0-9_-]+$/u;
const fixtureDirectory = join(process.cwd(), "src", "lab", "fixtures", "data");

export function labFixtureById(id: string): RawX86Fixture | undefined {
  const fixturePath = fixtureFilePath(id);

  if (fixturePath === undefined) {
    return undefined;
  }

  try {
    return rawX86FixtureFromJson(JSON.parse(readFileSync(fixturePath, "utf8")) as RawX86FixtureJson);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export function labFixtureIds(): readonly string[] {
  try {
    return readdirSync(fixtureDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => basename(entry.name, ".json"))
      .sort();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function fixtureFilePath(id: string): string | undefined {
  if (!fixtureIdPattern.test(id)) {
    return undefined;
  }

  return join(fixtureDirectory, `${id}.json`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
