import { describe, expect, it } from "vitest";
import { extractLastDigitFromQuote, extractLastDigitFromTick } from "./digit";
describe("centralized Digits extractor",()=>{
 it("handles prices",()=>{expect(extractLastDigitFromQuote(123)).toBe(0);expect(extractLastDigitFromQuote(12.3)).toBe(0);expect(extractLastDigitFromQuote(12.34)).toBe(4);});
 it("uses pip size",()=>{expect(extractLastDigitFromQuote(12.345,3)).toBe(5);expect(extractLastDigitFromTick({price:12.3456,pipSize:4})).toBe(6);});
 it("falls back and rejects invalid",()=>{expect(extractLastDigitFromQuote(12.345)).toBe(5);expect(extractLastDigitFromQuote("bad")).toBeNull();});
});
