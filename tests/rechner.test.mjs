// Taschenrechner der Prüfung
import { describe, it, expect } from "vitest";
import { rechnen } from "../packages/shared/src/rechner.mjs";

describe("Taschenrechner", () => {
  it("Grundrechenarten mit Punkt vor Strich, Klammern, Potenzen", () => {
    expect(rechnen("2+3*4")).toBe(14);
    expect(rechnen("(2+3)×4")).toBe(20);
    expect(rechnen("2^3^2")).toBe(512);
    expect(rechnen("2^-1")).toBe(0.5);
    expect(rechnen("-2^2")).toBe(-4);
    expect(rechnen("7÷2")).toBe(3.5);
    expect(rechnen("1,5+1")).toBe(2.5);
    expect(rechnen("50%*80")).toBe(40);
    expect(rechnen("5!")).toBe(120);
  });
  it("Funktionen in Grad und Bogenmass, Konstanten, implizites Mal", () => {
    expect(rechnen("sin(30)")).toBe(0.5);
    expect(rechnen("10*sin(35)")).toBeCloseTo(5.7358, 4);
    expect(rechnen("sin(pi/2)", { grad: false })).toBe(1);
    expect(rechnen("2pi")).toBeCloseTo(6.283185, 5);
    expect(rechnen("√16+log(100)+ln(e)")).toBe(7);
    expect(rechnen("asin(0.5)")).toBe(30);
    expect(rechnen("ans*2", { ans: 21 })).toBe(42);
  });
  it("verständliche Fehler, kein Code wird ausgeführt", () => {
    expect(() => rechnen("1/0")).toThrow(/Unendlich/);
    expect(() => rechnen("sqrt(-1)")).toThrow(/Nicht definiert/);
    expect(() => rechnen("(1+2")).toThrow(/Klammer/);
    expect(() => rechnen("alert(1)")).toThrow(/Unbekannt/);
    expect(() => rechnen("constructor")).toThrow(/Unbekannt/);
    expect(() => rechnen("2+")).toThrow(/unvollständig/);
  });
});
