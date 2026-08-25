const WATER_TRIPLE_POINT = 610.5;

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
