import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

let completedTests = 0;

export class Assert {
  static StringEqual(expected: string, actual: string | undefined): void {
    if (actual === undefined) throw new Error(`Expected '${expected}', received <undefined>`);
    if (actual !== expected) throw new Error(`Expected '${expected}', received '${actual}'`);
  }

  static NumberEqual(expected: number, actual: number | undefined): void {
    if (actual === undefined) throw new Error(`Expected ${expected}, received <undefined>`);
    if (actual !== expected) throw new Error(`Expected ${expected}, received ${actual}`);
  }

  static True(value: boolean): void {
    if (!value) throw new Error("Expected value to be true");
  }

  static False(value: boolean): void {
    if (value) throw new Error("Expected value to be false");
  }

  static StringArrayEqual(expected: string[], actual: string[]): void {
    if (actual.length !== expected.length) throw new Error("Expected arrays to have equal length");
    for (let index = 0; index < expected.length; index++) {
      if (actual[index] !== expected[index]) throw new Error("Expected arrays to contain equal values");
    }
  }
}

export const createTestDirectory = (name: string): string => {
  const configuredRoot = process.env["TSUMO_TEST_ROOT"];
  if (configuredRoot === undefined || configuredRoot.trim() === "") {
    throw new Error("TSUMO_TEST_ROOT must name the test-owned scratch directory");
  }
  const root = resolve(configuredRoot);
  mkdirSync(root, true);
  return mkdtempSync(join(root, `${name}-`));
};

export const createDirectory = (path: string): void => {
  mkdirSync(path, true);
};

export const writeTextFile = (path: string, content: string): void => {
  writeFileSync(path, content, "utf-8");
};

export const readTextFile = (path: string): string => readFileSync(path, "utf-8");

export const pathExists = (path: string): boolean => existsSync(path);

export const directoryExists = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();

export const fileExists = (path: string): boolean => existsSync(path) && statSync(path).isFile();

export const createSymbolicLink = (target: string, path: string): void => {
  symlinkSync(target, path);
};

export const deleteTestDirectory = (path: string): void => {
  rmSync(path, true);
};

export const runTest = (name: string, operation: () => void): void => {
  try {
    operation();
  } catch (error) {
    throw new Error(`${name}: ${error}`);
  }
  completedTests++;
  console.log(`PASS ${name}`);
};

export const completeTests = (expectedTests: number): void => {
  if (completedTests !== expectedTests) throw new Error("Test inventory did not execute completely");
  console.log(`${completedTests}/${expectedTests} tests passed`);
};
