const WATER_TRIPLE_POINT = 610.5;
const VAPOUR_PERMEABILITY_AIR = 2e-10;
const SECONDS_PER_DAY = 24 * 60 * 60;

export function saturationPressure(temperature) {
  const exponent = temperature >= 0
    ? (17.269 * temperature) / (237.3 + temperature)
    : (21.875 * temperature) / (265.5 + temperature);
  return WATER_TRIPLE_POINT * Math.exp(exponent);
}

export function dewPoint(pressure) {
  const safePressure = Math.max(pressure, 0.01);
  const logarithm = Math.log(safePressure / WATER_TRIPLE_POINT);
  return safePressure >= WATER_TRIPLE_POINT
    ? (237.3 * logarithm) / (17.269 - logarithm)
    : (265.5 * logarithm) / (21.875 - logarithm);
}

export function layerResistance(layer) {
  if (!layer.enabled) return { thermal: 0, diffusion: 0 };

  const thickness = Math.max(0, Number(layer.thicknessMm) || 0) / 1000;
  const lambda = Math.max(0.0001, Number(layer.lambda) || 0.0001);
  const mu = Math.max(0, Number(layer.mu) || 0);
  const thermal = layer.fixedR === null || layer.fixedR === undefined
    ? thickness / lambda
    : Math.max(0, Number(layer.fixedR) || 0);
  const diffusion = layer.fixedSd === null || layer.fixedSd === undefined
    ? thickness * mu
    : Math.max(0, Number(layer.fixedSd) || 0);

  return { thermal, diffusion };
}

export function calculateProfile(layers, conditions, surfaces = { inside: 0.1, outside: 0.04 }) {
  const activeLayers = layers.filter((layer) => layer.enabled);
  const layerData = activeLayers.map((layer) => ({
    ...layer,
    ...layerResistance(layer),
  }));
  const insideSurface = Math.max(0, Number(surfaces.inside) || 0);
  const outsideSurface = Math.max(0, Number(surfaces.outside) || 0);
  const layerThermal = layerData.reduce((sum, layer) => sum + layer.thermal, 0);
  const totalThermal = insideSurface + layerThermal + outsideSurface;
  const totalDiffusion = layerData.reduce((sum, layer) => sum + layer.diffusion, 0);
  const insideTemperature = Number(conditions.insideTemperature);
  const outsideTemperature = Number(conditions.outsideTemperature);
  const insideHumidity = Math.min(100, Math.max(0, Number(conditions.insideHumidity))) / 100;
  const outsideHumidity = Math.min(100, Math.max(0, Number(conditions.outsideHumidity))) / 100;
  const insidePressure = insideHumidity * saturationPressure(insideTemperature);
  const outsidePressure = outsideHumidity * saturationPressure(outsideTemperature);
  const temperatureDifference = insideTemperature - outsideTemperature;

  const atState = (cumulativeThermal, cumulativeDiffusion, positionMm, label, layerId, kind = "interface") => {
    const temperature = totalThermal > 0
      ? insideTemperature - temperatureDifference * (cumulativeThermal / totalThermal)
      : insideTemperature;
    const pressure = totalDiffusion > 0
      ? insidePressure - (insidePressure - outsidePressure) * (cumulativeDiffusion / totalDiffusion)
      : insidePressure;
    const saturation = saturationPressure(temperature);
    return {
      positionMm,
      label,
      layerId,
      kind,
      temperature,
      pressure,
      dewPoint: dewPoint(pressure),
      saturationRatio: saturation > 0 ? (pressure / saturation) * 100 : 0,
    };
  };

  const interfaces = [
    atState(0, 0, 0, "Vnitřní vzduch", null, "air"),
    atState(insideSurface, 0, 0, "Vnitřní povrch", null, "surface"),
  ];
  const points = [...interfaces];
  let cumulativeThermal = insideSurface;
  let cumulativeDiffusion = 0;
  let positionMm = 0;
  let firstRisk = null;
  let maxSaturation = Math.max(...points.map((point) => point.saturationRatio));

  for (const layer of layerData) {
    const samples = Math.max(2, Math.min(80, Math.ceil(Math.max(layer.thermal / 0.08, layer.diffusion / 2, layer.thicknessMm / 5))));
    for (let index = 1; index <= samples; index += 1) {
      const fraction = index / samples;
      const point = atState(
        cumulativeThermal + layer.thermal * fraction,
        cumulativeDiffusion + layer.diffusion * fraction,
        positionMm + layer.thicknessMm * fraction,
        layer.name,
        layer.id,
        "sample",
      );
      points.push(point);
      maxSaturation = Math.max(maxSaturation, point.saturationRatio);
      if (!firstRisk && point.saturationRatio >= 100) {
        firstRisk = {
          layerId: layer.id,
          layerName: layer.name,
          positionMm: point.positionMm,
          temperature: point.temperature,
          dewPoint: point.dewPoint,
        };
      }
    }

    cumulativeThermal += layer.thermal;
    cumulativeDiffusion += layer.diffusion;
    positionMm += Number(layer.thicknessMm) || 0;
    const boundary = atState(
      cumulativeThermal,
      cumulativeDiffusion,
      positionMm,
      `Za vrstvou: ${layer.name}`,
      layer.id,
      "interface",
    );
    interfaces.push(boundary);
  }

  const outsideSurfaceState = atState(
    insideSurface + layerThermal,
    totalDiffusion,
    positionMm,
    "Vnější povrch",
    null,
    "surface",
  );
  const outsideAirState = atState(
    totalThermal,
    totalDiffusion,
    positionMm,
    "Venkovní vzduch",
    null,
    "air",
  );
  interfaces.push(outsideSurfaceState, outsideAirState);
  points.push(outsideSurfaceState, outsideAirState);

  const heatFlux = totalThermal > 0 ? temperatureDifference / totalThermal : 0;
  const status = maxSaturation >= 100 ? "risk" : maxSaturation >= 95 ? "warning" : "safe";

  return {
    totalThermal,
    layerThermal,
    totalDiffusion,
    uValue: totalThermal > 0 ? 1 / totalThermal : 0,
    heatFlux,
    maxSaturation,
    firstRisk,
    status,
    points,
    interfaces,
    activeLayers: layerData,
  };
}

function monthlyBalanceAtPlane(layers, monthlyClimate, surfaces, planeIndex) {
  const activeLayers = layers.filter((layer) => layer.enabled);
  const layerData = activeLayers.map((layer) => ({
    ...layer,
    ...layerResistance(layer),
  }));
  const diffusionInside = layerData
    .slice(0, planeIndex + 1)
    .reduce((sum, layer) => sum + layer.diffusion, 0);
  const totalDiffusion = layerData.reduce((sum, layer) => sum + layer.diffusion, 0);
  const diffusionOutside = totalDiffusion - diffusionInside;

  if (diffusionInside <= 0 || diffusionOutside <= 0) return null;

  const potentials = monthlyClimate.map((month) => {
    const profile = calculateProfile(activeLayers, month, surfaces);
    const point = profile.interfaces[planeIndex + 2];
    const insidePressure = saturationPressure(Number(month.insideTemperature))
      * Math.min(100, Math.max(0, Number(month.insideHumidity))) / 100;
    const outsidePressure = saturationPressure(Number(month.outsideTemperature))
      * Math.min(100, Math.max(0, Number(month.outsideHumidity))) / 100;
    const interfaceSaturation = saturationPressure(point.temperature);
    const inwardFlux = VAPOUR_PERMEABILITY_AIR * (insidePressure - interfaceSaturation) / diffusionInside;
    const outwardFlux = VAPOUR_PERMEABILITY_AIR * (interfaceSaturation - outsidePressure) / diffusionOutside;
    const seconds = Math.max(1, Number(month.days) || 30) * SECONDS_PER_DAY;
    const potentialGm2 = (inwardFlux - outwardFlux) * seconds * 1000;

    return {
      ...month,
      point,
      potentialGm2,
      drySaturationRatio: point.saturationRatio,
    };
  });

  const annualPotentialGm2 = potentials.reduce((sum, month) => sum + month.potentialGm2, 0);
  const hasCondensation = potentials.some((month) => month.potentialGm2 > 0.000001);

  const simulateYear = (startingMoistureGm2) => {
    let storedGm2 = Math.max(0, startingMoistureGm2);
    const months = potentials.map((month) => {
      const condensationGm2 = Math.max(0, month.potentialGm2);
      const evaporationCapacityGm2 = Math.max(0, -month.potentialGm2);
      const evaporationGm2 = Math.min(storedGm2 + condensationGm2, evaporationCapacityGm2);
      storedGm2 = Math.max(0, storedGm2 + condensationGm2 - evaporationGm2);
      return {
        ...month,
        condensationGm2,
        evaporationGm2,
        netGm2: condensationGm2 - evaporationGm2,
        storedGm2,
      };
    });
    return { months, endingMoistureGm2: storedGm2 };
  };

  let simulation = simulateYear(0);
  let startingMoistureGm2 = 0;

  // U skladby, která v ročním cyklu vysychá, ustálíme stav přes hranici
  // prosinec/leden. U trvale narůstající vlhkosti ukazujeme první rok od nuly.
  if (hasCondensation && annualPotentialGm2 < -0.000001) {
    for (let cycle = 0; cycle < 24; cycle += 1) {
      const next = simulateYear(simulation.endingMoistureGm2);
      if (Math.abs(next.endingMoistureGm2 - simulation.endingMoistureGm2) < 0.001) {
        simulation = next;
        break;
      }
      simulation = next;
    }
    startingMoistureGm2 = simulation.endingMoistureGm2;
    simulation = simulateYear(startingMoistureGm2);
  }

  const peakStoredGm2 = Math.max(startingMoistureGm2, ...simulation.months.map((month) => month.storedGm2));
  const annualCondensationGm2 = simulation.months.reduce((sum, month) => sum + month.condensationGm2, 0);
  const annualEvaporationGm2 = simulation.months.reduce((sum, month) => sum + month.evaporationGm2, 0);
  const maxSaturation = Math.max(...potentials.map((month) => month.drySaturationRatio));
  const status = annualPotentialGm2 > 0.001 && hasCondensation
    ? "risk"
    : peakStoredGm2 > 0.001
      ? "warning"
      : "safe";

  const layer = activeLayers[planeIndex];
  return {
    planeIndex,
    layerId: layer.id,
    label: `Za vrstvou: ${layer.name}`,
    positionMm: potentials[0]?.point.positionMm ?? 0,
    diffusionInside,
    diffusionOutside,
    annualPotentialGm2,
    annualCondensationGm2,
    annualEvaporationGm2,
    startingMoistureGm2,
    endingMoistureGm2: simulation.endingMoistureGm2,
    peakStoredGm2,
    maxSaturation,
    hasCondensation,
    fullyDries: hasCondensation && annualPotentialGm2 <= 0.001,
    status,
    months: simulation.months,
  };
}

export function calculateMonthlyBalance(layers, monthlyClimate, surfaces = { inside: 0.1, outside: 0.04 }) {
  const activeLayers = layers.filter((layer) => layer.enabled);
  if (activeLayers.length < 2 || !Array.isArray(monthlyClimate) || monthlyClimate.length === 0) {
    return {
      status: "safe",
      governingPlane: null,
      planes: [],
      months: [],
      annualCondensationGm2: 0,
      annualEvaporationGm2: 0,
      annualPotentialGm2: 0,
      peakStoredGm2: 0,
      endingMoistureGm2: 0,
      fullyDries: true,
    };
  }

  const planes = activeLayers
    .slice(0, -1)
    .map((_, planeIndex) => monthlyBalanceAtPlane(activeLayers, monthlyClimate, surfaces, planeIndex))
    .filter(Boolean);
  const severity = { risk: 2, warning: 1, safe: 0 };
  const governingPlane = [...planes].sort((left, right) => (
    severity[right.status] - severity[left.status]
    || right.peakStoredGm2 - left.peakStoredGm2
    || right.maxSaturation - left.maxSaturation
  ))[0] ?? null;

  if (!governingPlane) {
    return {
      status: "safe",
      governingPlane: null,
      planes,
      months: [],
      annualCondensationGm2: 0,
      annualEvaporationGm2: 0,
      annualPotentialGm2: 0,
      peakStoredGm2: 0,
      endingMoistureGm2: 0,
      fullyDries: true,
    };
  }

  return {
    status: governingPlane.status,
    governingPlane,
    planes,
    months: governingPlane.months,
    annualCondensationGm2: governingPlane.annualCondensationGm2,
    annualEvaporationGm2: governingPlane.annualEvaporationGm2,
    annualPotentialGm2: governingPlane.annualPotentialGm2,
    peakStoredGm2: governingPlane.peakStoredGm2,
    endingMoistureGm2: governingPlane.endingMoistureGm2,
    fullyDries: governingPlane.fullyDries,
  };
}
