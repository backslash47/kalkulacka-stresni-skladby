import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateProfile,
  dewPoint,
  saturationPressure,
} from "../app/calculation.mjs";

function layer(id, name, thicknessMm, lambda, mu, fixedR = null, fixedSd = null) {
  return {
    id,
    name,
    thicknessMm,
    lambda,
    mu,
    fixedR,
    fixedSd,
    enabled: true,
  };
}

const conditions = {
  insideTemperature: 21,
  insideHumidity: 50,
  outsideTemperature: -15,
  outsideHumidity: 84,
};

const exterior = [
  layer("osb", "OSB", 25, 0.1, 100),
  layer("bitumen", "GLASTEK", 4, 0.17, 27000, null, 108),
  layer("pir", "PIR", 160, 0.022, 260, 7.25, 41.6),
  layer("pvc", "PVC", 1.8, 0.16, 20000, null, 36),
];

const interior = [
  layer("plaster", "Omítka", 20, 0.87, 10),
  layer("boarding", "Bednění", 20, 0.13, 20),
];

test("computes saturation pressure and dew point at the indoor state", () => {
  const pressure = saturationPressure(21) * 0.5;
  assert.ok(Math.abs(saturationPressure(21) - 2485.6) < 0.2);
  assert.ok(Math.abs(dewPoint(pressure) - 10.19) < 0.02);
});

test("reproduces the configured with-wool screening result", () => {
  const result = calculateProfile([
    ...interior,
    layer("wool", "Vata", 180, 0.035, 1),
    layer("air", "Dutina", 220, 0.15, 1, 0.16, 0.22),
    ...exterior,
  ], conditions);

  assert.ok(Math.abs(result.uValue - 0.07602) < 0.0001);
  assert.equal(result.status, "risk");
  assert.equal(result.firstRisk.layerId, "wool");

  const afterOsb = result.interfaces.find((point) => point.label === "Za vrstvou: OSB");
  assert.ok(Math.abs(afterOsb.temperature - 5.05) < 0.02);
  assert.ok(afterOsb.dewPoint > afterOsb.temperature);
});

test("keeps the OSB warm in the no-wool field while finding the outer risk", () => {
  const result = calculateProfile([
    ...interior,
    layer("air", "Dutina", 400, 0.15, 1, 0.16, 0.4),
    ...exterior,
  ], conditions);

  assert.ok(Math.abs(result.uValue - 0.12482) < 0.0001);
  const afterOsb = result.interfaces.find((point) => point.label === "Za vrstvou: OSB");
  assert.ok(afterOsb.temperature > afterOsb.dewPoint);
  assert.equal(result.firstRisk.layerId, "pir");
});
