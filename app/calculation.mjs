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
    const saturationRatio = saturation > 0 ? (pressure / saturation) * 100 : 0;
    return {
      positionMm,
      label,
      layerId,
      kind,
      temperature,
      pressure,
      dewPoint: dewPoint(pressure),
      saturationPressure: saturation,
      saturationRatio,
      relativeHumidity: Math.min(100, saturationRatio),
      condensationRatio: saturationRatio / 100,
      excessPressure: Math.max(0, pressure - saturation),
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

  const locatePoint = (point) => {
    let startMm = 0;
    for (let index = 0; index < layerData.length; index += 1) {
      const layer = layerData[index];
      const endMm = startMm + (Number(layer.thicknessMm) || 0);
      if (Math.abs(point.positionMm - endMm) < 0.01 && index < layerData.length - 1) {
        return `rozhraní ${layer.name} / ${layerData[index + 1].name}`;
      }
      if (point.positionMm >= startMm && point.positionMm < endMm) {
        const depthMm = Math.max(0, point.positionMm - startMm);
        return `uvnitř vrstvy ${layer.name} (${Math.round(depthMm)} mm od jejího vnitřního líce)`;
      }
      startMm = endMm;
    }
    return point.label.toLowerCase();
  };

  const riskyPoints = points.filter((point) => point.kind === "sample" && point.saturationRatio >= 100);
  const firstRiskPoint = riskyPoints[0] ?? null;
  const peakRiskPoint = riskyPoints.reduce(
    (peak, point) => !peak || point.saturationRatio > peak.saturationRatio ? point : peak,
    null,
  );
  const describeRisk = (point) => point ? {
    layerId: point.layerId,
    layerName: point.label,
    locationLabel: locatePoint(point),
    positionMm: point.positionMm,
    temperature: point.temperature,
    dewPoint: point.dewPoint,
    saturationRatio: point.saturationRatio,
    condensationRatio: point.condensationRatio,
    excessPressure: point.excessPressure,
  } : null;
  const firstRisk = describeRisk(firstRiskPoint);
  const peakRisk = describeRisk(peakRiskPoint);

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
    peakRisk,
    status,
    points,
    interfaces,
    activeLayers: layerData,
  };
}

const MONTHLY_STORAGE_EPSILON = 0.000001;
const MONTHLY_BALANCE_TOLERANCE = 0.001;
const MONTHLY_PRESSURE_TOLERANCE = 0.01;

function emptyMonthlyResult() {
  return {
    model: "coupled-multiplane",
    hasCalculation: false,
    status: "safe",
    governingPlane: null,
    locations: [],
    planes: [],
    months: [],
    annualCondensationGm2: 0,
    annualEvaporationGm2: 0,
    annualPotentialGm2: 0,
    annualChangeGm2: 0,
    peakStoredGm2: 0,
    startingMoistureGm2: 0,
    endingMoistureGm2: 0,
    fullyDries: true,
    cyclesSimulated: 0,
  };
}

function buildMonthlyNodes(layerData, surfaces) {
  const insideSurface = Math.max(0, Number(surfaces.inside) || 0);
  const outsideSurface = Math.max(0, Number(surfaces.outside) || 0);
  const layerThermal = layerData.reduce((sum, layer) => sum + layer.thermal, 0);
  const totalThermal = insideSurface + layerThermal + outsideSurface;
  const totalDiffusion = layerData.reduce(
    (sum, layer) => sum + Math.max(layer.diffusion, 1e-8),
    0,
  );
  const nodes = [];
  let thermalCoordinate = insideSurface;
  let diffusionCoordinate = 0;
  let positionMm = 0;

  for (let layerIndex = 0; layerIndex < layerData.length; layerIndex += 1) {
    const layer = layerData[layerIndex];
    const thicknessMm = Math.max(0, Number(layer.thicknessMm) || 0);
    const layerDiffusion = Math.max(layer.diffusion, 1e-8);
    const sampleCount = Math.max(1, Math.min(60, Math.ceil(thicknessMm / 10)));

    for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
      const isLayerEnd = sampleIndex === sampleCount;
      const isExteriorBoundary = isLayerEnd && layerIndex === layerData.length - 1;
      if (isExteriorBoundary) continue;

      const fraction = sampleIndex / sampleCount;
      const nextLayer = layerData[layerIndex + 1];
      const isInterface = isLayerEnd && Boolean(nextLayer);
      nodes.push({
        index: nodes.length,
        layerId: layer.id,
        layerName: layer.name,
        nextLayerId: isInterface ? nextLayer.id : null,
        nextLayerName: isInterface ? nextLayer.name : null,
        kind: isInterface ? "interface" : "layer",
        groupId: isInterface ? `interface:${layer.id}:${nextLayer.id}` : `layer:${layer.id}`,
        groupLabel: isInterface
          ? `Rozhraní ${layer.name} / ${nextLayer.name}`
          : `Uvnitř vrstvy ${layer.name}`,
        positionMm: positionMm + thicknessMm * fraction,
        thermalCoordinate: thermalCoordinate + layer.thermal * fraction,
        diffusionCoordinate: diffusionCoordinate + layerDiffusion * fraction,
      });
    }

    positionMm += thicknessMm;
    thermalCoordinate += layer.thermal;
    diffusionCoordinate += layerDiffusion;
  }

  return { nodes, totalThermal, totalDiffusion };
}

function monthlyNodeStates(spatial, month) {
  const insideTemperature = Number(month.insideTemperature);
  const outsideTemperature = Number(month.outsideTemperature);
  const temperatureDifference = insideTemperature - outsideTemperature;
  return spatial.nodes.map((node) => {
    const temperature = spatial.totalThermal > 0
      ? insideTemperature - temperatureDifference * (node.thermalCoordinate / spatial.totalThermal)
      : insideTemperature;
    return {
      ...node,
      temperature,
      saturationPressure: saturationPressure(temperature),
    };
  });
}

function boundaryPressure(temperature, humidity) {
  return saturationPressure(Number(temperature))
    * Math.min(100, Math.max(0, Number(humidity))) / 100;
}

function pressureProfile(nodeStates, totalDiffusion, insidePressure, outsidePressure, activeIndexes) {
  const anchors = [
    { nodeIndex: -1, diffusionCoordinate: 0, pressure: insidePressure },
    ...[...activeIndexes]
      .sort((left, right) => left - right)
      .map((nodeIndex) => ({
        nodeIndex,
        diffusionCoordinate: nodeStates[nodeIndex].diffusionCoordinate,
        pressure: nodeStates[nodeIndex].saturationPressure,
      })),
    { nodeIndex: nodeStates.length, diffusionCoordinate: totalDiffusion, pressure: outsidePressure },
  ];
  const pressures = new Array(nodeStates.length);

  for (let anchorIndex = 0; anchorIndex < anchors.length - 1; anchorIndex += 1) {
    const left = anchors[anchorIndex];
    const right = anchors[anchorIndex + 1];
    const span = Math.max(1e-12, right.diffusionCoordinate - left.diffusionCoordinate);
    const firstNode = left.nodeIndex + 1;
    const lastNode = right.nodeIndex;
    for (let nodeIndex = firstNode; nodeIndex <= lastNode && nodeIndex < nodeStates.length; nodeIndex += 1) {
      const fraction = (nodeStates[nodeIndex].diffusionCoordinate - left.diffusionCoordinate) / span;
      pressures[nodeIndex] = left.pressure + (right.pressure - left.pressure) * fraction;
    }
    if (right.nodeIndex < nodeStates.length) pressures[right.nodeIndex] = right.pressure;
  }
  return pressures;
}

function condensationRates(nodeStates, totalDiffusion, insidePressure, outsidePressure, activeIndexes, pressures) {
  const sorted = [...activeIndexes].sort((left, right) => left - right);
  const anchors = [
    { nodeIndex: -1, diffusionCoordinate: 0, pressure: insidePressure },
    ...sorted.map((nodeIndex) => ({
      nodeIndex,
      diffusionCoordinate: nodeStates[nodeIndex].diffusionCoordinate,
      pressure: pressures[nodeIndex],
    })),
    { nodeIndex: nodeStates.length, diffusionCoordinate: totalDiffusion, pressure: outsidePressure },
  ];
  const rates = new Map();

  for (let anchorIndex = 1; anchorIndex < anchors.length - 1; anchorIndex += 1) {
    const previous = anchors[anchorIndex - 1];
    const current = anchors[anchorIndex];
    const next = anchors[anchorIndex + 1];
    const inwardFlux = VAPOUR_PERMEABILITY_AIR
      * (previous.pressure - current.pressure)
      / Math.max(1e-12, current.diffusionCoordinate - previous.diffusionCoordinate);
    const outwardFlux = VAPOUR_PERMEABILITY_AIR
      * (current.pressure - next.pressure)
      / Math.max(1e-12, next.diffusionCoordinate - current.diffusionCoordinate);
    rates.set(current.nodeIndex, inwardFlux - outwardFlux);
  }
  return rates;
}

function solveMonthlyState(nodeStates, totalDiffusion, insidePressure, outsidePressure, storageGm2) {
  const mandatory = new Set(
    storageGm2.flatMap((stored, index) => stored > MONTHLY_STORAGE_EPSILON ? [index] : []),
  );
  const active = new Set(mandatory);
  let pressures = [];
  let rates = new Map();

  for (let iteration = 0; iteration < nodeStates.length * 4 + 20; iteration += 1) {
    pressures = pressureProfile(nodeStates, totalDiffusion, insidePressure, outsidePressure, active);
    rates = condensationRates(nodeStates, totalDiffusion, insidePressure, outsidePressure, active, pressures);

    let removeIndex = -1;
    let mostNegativeRate = -1e-15;
    for (const nodeIndex of active) {
      const rate = rates.get(nodeIndex) ?? 0;
      if (!mandatory.has(nodeIndex) && rate < mostNegativeRate) {
        removeIndex = nodeIndex;
        mostNegativeRate = rate;
      }
    }
    if (removeIndex >= 0) {
      active.delete(removeIndex);
      continue;
    }

    let addIndex = -1;
    let largestExcess = MONTHLY_PRESSURE_TOLERANCE;
    for (let nodeIndex = 0; nodeIndex < nodeStates.length; nodeIndex += 1) {
      if (active.has(nodeIndex)) continue;
      const excess = pressures[nodeIndex] - nodeStates[nodeIndex].saturationPressure;
      if (excess > largestExcess) {
        addIndex = nodeIndex;
        largestExcess = excess;
      }
    }
    if (addIndex >= 0) {
      active.add(addIndex);
      continue;
    }
    break;
  }

  pressures = pressureProfile(nodeStates, totalDiffusion, insidePressure, outsidePressure, active);
  rates = condensationRates(nodeStates, totalDiffusion, insidePressure, outsidePressure, active, pressures);
  return { active, pressures, rates };
}

function simulateMonth(spatial, month, startingStorageGm2) {
  const nodeStates = monthlyNodeStates(spatial, month);
  const insidePressure = boundaryPressure(month.insideTemperature, month.insideHumidity);
  const outsidePressure = boundaryPressure(month.outsideTemperature, month.outsideHumidity);
  const storageGm2 = [...startingStorageGm2];
  const condensationGm2 = new Array(nodeStates.length).fill(0);
  const evaporationGm2 = new Array(nodeStates.length).fill(0);
  const totalSeconds = Math.max(1, Number(month.days) || 30) * SECONDS_PER_DAY;
  let remainingSeconds = totalSeconds;
  let eventCount = 0;

  while (remainingSeconds > 0.001 && eventCount < nodeStates.length * 3 + 20) {
    const solved = solveMonthlyState(
      nodeStates,
      spatial.totalDiffusion,
      insidePressure,
      outsidePressure,
      storageGm2,
    );
    let stepSeconds = remainingSeconds;

    for (const nodeIndex of solved.active) {
      const rateGm2s = (solved.rates.get(nodeIndex) ?? 0) * 1000;
      if (storageGm2[nodeIndex] > MONTHLY_STORAGE_EPSILON && rateGm2s < 0) {
        stepSeconds = Math.min(stepSeconds, storageGm2[nodeIndex] / -rateGm2s);
      }
    }

    stepSeconds = Math.max(0.000001, stepSeconds);
    for (const nodeIndex of solved.active) {
      const changeGm2 = (solved.rates.get(nodeIndex) ?? 0) * 1000 * stepSeconds;
      if (changeGm2 >= 0) {
        storageGm2[nodeIndex] += changeGm2;
        condensationGm2[nodeIndex] += changeGm2;
      } else {
        const evaporated = Math.min(storageGm2[nodeIndex], -changeGm2);
        storageGm2[nodeIndex] -= evaporated;
        evaporationGm2[nodeIndex] += evaporated;
      }
      if (storageGm2[nodeIndex] < MONTHLY_STORAGE_EPSILON) storageGm2[nodeIndex] = 0;
    }

    remainingSeconds = Math.max(0, remainingSeconds - stepSeconds);
    eventCount += 1;
  }

  const dryPressures = pressureProfile(nodeStates, spatial.totalDiffusion, insidePressure, outsidePressure, new Set());
  return {
    ...month,
    condensationGm2,
    evaporationGm2,
    storageGm2,
    drySaturationRatios: dryPressures.map((pressure, index) => (
      pressure / nodeStates[index].saturationPressure
    )),
  };
}

function simulateYear(spatial, monthlyClimate, startingStorageGm2) {
  let storageGm2 = [...startingStorageGm2];
  const months = monthlyClimate.map((month) => {
    const result = simulateMonth(spatial, month, storageGm2);
    storageGm2 = result.storageGm2;
    return result;
  });
  return { months, endingStorageGm2: [...storageGm2] };
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function aggregateMonthlyLocations(spatial, simulation, startingStorageGm2) {
  const groupMap = new Map();
  for (const node of spatial.nodes) {
    groupMap.set(node.groupId, groupMap.get(node.groupId) ?? {
      id: node.groupId,
      label: node.groupLabel,
      kind: node.kind,
      layerId: node.layerId,
      nextLayerId: node.nextLayerId,
      nodeIndexes: [],
    });
    groupMap.get(node.groupId).nodeIndexes.push(node.index);
  }

  const locations = [...groupMap.values()].map((group) => {
    const nodeIndexes = group.nodeIndexes;
    const months = simulation.months.map((month) => ({
      id: month.id,
      month: month.month,
      days: month.days,
      insideTemperature: month.insideTemperature,
      insideHumidity: month.insideHumidity,
      outsideTemperature: month.outsideTemperature,
      outsideHumidity: month.outsideHumidity,
      condensationGm2: sum(nodeIndexes.map((index) => month.condensationGm2[index])),
      evaporationGm2: sum(nodeIndexes.map((index) => month.evaporationGm2[index])),
      storedGm2: sum(nodeIndexes.map((index) => month.storageGm2[index])),
      drySaturationRatio: Math.max(...nodeIndexes.map((index) => month.drySaturationRatios[index])),
    })).map((month) => ({
      ...month,
      netGm2: month.condensationGm2 - month.evaporationGm2,
    }));
    const relevantIndexes = nodeIndexes.filter((nodeIndex) => (
      startingStorageGm2[nodeIndex] > MONTHLY_STORAGE_EPSILON
      || simulation.months.some((month) => (
        month.condensationGm2[nodeIndex] > MONTHLY_STORAGE_EPSILON
        || month.evaporationGm2[nodeIndex] > MONTHLY_STORAGE_EPSILON
        || month.storageGm2[nodeIndex] > MONTHLY_STORAGE_EPSILON
      ))
    ));
    const positions = (relevantIndexes.length > 0 ? relevantIndexes : nodeIndexes)
      .map((index) => spatial.nodes[index].positionMm);
    const startingMoistureGm2 = sum(nodeIndexes.map((index) => startingStorageGm2[index]));
    const endingMoistureGm2 = months.at(-1)?.storedGm2 ?? 0;
    const annualCondensationGm2 = sum(months.map((month) => month.condensationGm2));
    const annualEvaporationGm2 = sum(months.map((month) => month.evaporationGm2));
    const annualChangeGm2 = endingMoistureGm2 - startingMoistureGm2;
    const peakStoredGm2 = Math.max(startingMoistureGm2, ...months.map((month) => month.storedGm2));
    const hasCondensation = annualCondensationGm2 > MONTHLY_BALANCE_TOLERANCE;
    const status = annualChangeGm2 > MONTHLY_BALANCE_TOLERANCE
      ? "risk"
      : hasCondensation ? "warning" : "safe";
    return {
      ...group,
      nodeIndexes: undefined,
      positionMm: (Math.min(...positions) + Math.max(...positions)) / 2,
      positionStartMm: Math.min(...positions),
      positionEndMm: Math.max(...positions),
      annualCondensationGm2,
      annualEvaporationGm2,
      annualPotentialGm2: annualChangeGm2,
      annualChangeGm2,
      startingMoistureGm2,
      endingMoistureGm2,
      peakStoredGm2,
      maxSaturation: Math.max(...months.map((month) => month.drySaturationRatio)) * 100,
      hasCondensation,
      fullyDries: hasCondensation && months.some((month) => month.storedGm2 <= MONTHLY_BALANCE_TOLERANCE),
      status,
      months,
    };
  });

  return locations.filter((location) => (
    location.hasCondensation
    || location.annualEvaporationGm2 > MONTHLY_BALANCE_TOLERANCE
    || location.peakStoredGm2 > MONTHLY_BALANCE_TOLERANCE
  ));
}

export function calculateMonthlyBalance(layers, monthlyClimate, surfaces = { inside: 0.1, outside: 0.04 }) {
  const activeLayers = layers.filter((layer) => layer.enabled);
  if (activeLayers.length < 2 || !Array.isArray(monthlyClimate) || monthlyClimate.length === 0) {
    return emptyMonthlyResult();
  }

  const layerData = activeLayers.map((layer) => ({ ...layer, ...layerResistance(layer) }));
  const spatial = buildMonthlyNodes(layerData, surfaces);
  if (spatial.nodes.length === 0 || spatial.totalDiffusion <= 0) return emptyMonthlyResult();

  const emptyStorage = new Array(spatial.nodes.length).fill(0);
  const firstYear = simulateYear(spatial, monthlyClimate, emptyStorage);
  let startingStorageGm2 = emptyStorage;
  let simulation = firstYear;
  let stabilized = sum(firstYear.endingStorageGm2) <= MONTHLY_BALANCE_TOLERANCE;
  let cyclesSimulated = 1;

  if (!stabilized) {
    let cycleStart = [...firstYear.endingStorageGm2];
    for (let cycle = 2; cycle <= 24; cycle += 1) {
      const next = simulateYear(spatial, monthlyClimate, cycleStart);
      cyclesSimulated = cycle;
      const largestChange = Math.max(...next.endingStorageGm2.map((value, index) => (
        Math.abs(value - cycleStart[index])
      )));
      if (largestChange <= MONTHLY_BALANCE_TOLERANCE) {
        startingStorageGm2 = cycleStart;
        simulation = next;
        stabilized = true;
        break;
      }
      cycleStart = [...next.endingStorageGm2];
    }
  }

  // U trvale akumulační skladby reportujeme první rok od suchého počátku.
  if (!stabilized) {
    startingStorageGm2 = emptyStorage;
    simulation = firstYear;
  }

  const locations = aggregateMonthlyLocations(spatial, simulation, startingStorageGm2);
  const months = simulation.months.map((month) => {
    const condensationGm2 = sum(month.condensationGm2);
    const evaporationGm2 = sum(month.evaporationGm2);
    return {
      id: month.id,
      month: month.month,
      days: month.days,
      insideTemperature: month.insideTemperature,
      insideHumidity: month.insideHumidity,
      outsideTemperature: month.outsideTemperature,
      outsideHumidity: month.outsideHumidity,
      condensationGm2,
      evaporationGm2,
      netGm2: condensationGm2 - evaporationGm2,
      storedGm2: sum(month.storageGm2),
    };
  });
  const startingMoistureGm2 = sum(startingStorageGm2);
  const endingMoistureGm2 = sum(simulation.endingStorageGm2);
  const annualCondensationGm2 = sum(months.map((month) => month.condensationGm2));
  const annualEvaporationGm2 = sum(months.map((month) => month.evaporationGm2));
  const annualChangeGm2 = endingMoistureGm2 - startingMoistureGm2;
  const peakStoredGm2 = Math.max(startingMoistureGm2, ...months.map((month) => month.storedGm2));
  const severity = { risk: 2, warning: 1, safe: 0 };
  const governingPlane = [...locations].sort((left, right) => (
    severity[right.status] - severity[left.status]
    || right.peakStoredGm2 - left.peakStoredGm2
    || right.annualCondensationGm2 - left.annualCondensationGm2
  ))[0] ?? null;
  const status = annualChangeGm2 > MONTHLY_BALANCE_TOLERANCE
    ? "risk"
    : annualCondensationGm2 > MONTHLY_BALANCE_TOLERANCE ? "warning" : "safe";

  return {
    model: "coupled-multiplane",
    hasCalculation: true,
    status,
    governingPlane,
    locations,
    planes: locations,
    months,
    annualCondensationGm2,
    annualEvaporationGm2,
    annualPotentialGm2: annualChangeGm2,
    annualChangeGm2,
    peakStoredGm2,
    startingMoistureGm2,
    endingMoistureGm2,
    fullyDries: annualCondensationGm2 <= MONTHLY_BALANCE_TOLERANCE
      || months.some((month) => month.storedGm2 <= MONTHLY_BALANCE_TOLERANCE),
    cyclesSimulated,
  };
}
