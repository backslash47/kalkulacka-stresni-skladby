import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateMonthlyBalance,
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

const brnoClimate = [
  ["jan", "Leden", 31, -2.56, 91.77],
  ["feb", "Únor", 28, -0.59, 87.74],
  ["mar", "Březen", 31, 3.9, 80.33],
  ["apr", "Duben", 30, 9.79, 73.43],
  ["may", "Květen", 31, 14.74, 70.78],
  ["jun", "Červen", 30, 19.19, 66.13],
  ["jul", "Červenec", 31, 21.45, 61.88],
  ["aug", "Srpen", 31, 20.94, 62.41],
  ["sep", "Září", 30, 15.38, 69.64],
  ["oct", "Říjen", 31, 9.35, 80.91],
  ["nov", "Listopad", 30, 4.25, 88.98],
  ["dec", "Prosinec", 31, -1.12, 92.33],
].map(([id, month, days, outsideTemperature, outsideHumidity]) => ({
  id,
  month,
  days,
  insideTemperature: 21,
  insideHumidity: 50,
  outsideTemperature,
  outsideHumidity,
}));

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

test("balances seasonal condensation and drying across the calendar boundary", () => {
  const result = calculateMonthlyBalance([
    ...interior,
    layer("wool", "Vata", 180, 0.035, 1),
    layer("air", "Dutina", 220, 0.15, 1, 0.16, 0.22),
    ...exterior,
  ], brnoClimate);

  assert.equal(result.status, "warning");
  assert.equal(result.governingPlane.layerId, "pir");
  assert.ok(Math.abs(result.peakStoredGm2 - 4.7316) < 0.001);
  assert.ok(Math.abs(result.annualCondensationGm2 - result.annualEvaporationGm2) < 0.001);
  assert.ok(result.months.some((month) => month.condensationGm2 > 0));
  assert.ok(result.months.some((month) => month.evaporationGm2 > 0));
  assert.ok(result.months.every((month) => month.storedGm2 >= 0));
});

test("marks a construction with a positive annual moisture balance as risk", () => {
  const coldYear = brnoClimate.map((month) => ({
    ...month,
    insideHumidity: 70,
    outsideTemperature: -10,
    outsideHumidity: 90,
  }));
  const result = calculateMonthlyBalance([
    layer("inside", "Vnitřní deska", 15, 0.2, 5),
    layer("insulation", "Izolace", 200, 0.04, 1),
    layer("outer", "Difuzně uzavřená vrstva", 4, 0.2, 25000),
  ], coldYear);

  assert.equal(result.status, "risk");
  assert.ok(result.annualPotentialGm2 > 0);
  assert.ok(result.endingMoistureGm2 > 0);
});
