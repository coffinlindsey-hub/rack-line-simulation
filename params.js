/*
 * Every number the model uses, in one place.
 *
 * tag: 'sourced'    = taken from a public source listed in SOURCES
 *      'assumption' = a placeholder chosen to be plausible; no public figure found
 *      'setting'    = a choice about the experiment, not a claim about the world
 *
 * Nothing here comes from any company's internal data.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RackParams = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SOURCES = {
    smc: { label: 'Supermicro, NVIDIA GB200 NVL72 datasheet', url: 'https://www.supermicro.com/datasheet/datasheet_SuperCluster_GB200_NVL72.pdf', says: 'Power shelves total 132 kW; operating power 125 to 135 kW.' },
    hpe: { label: 'HPE QuickSpecs, NVIDIA GB200 NVL72 by HPE', url: 'https://www.hpe.com/il/en/collaterals/collateral.a50009224enw.html', says: 'Rack thermal design power 132 kW; about 3,245 lb fully loaded.' },
    fierce: { label: 'Fierce Electronics, Blackwell platform coverage (2024)', url: 'https://www.fierceelectronics.com/ai/blackwell-platform-puts-jensen-higher-realm-cost-and-energy', says: 'A GB200 NVL72 rack is a 120 kW system weighing about 3,000 lb; an analyst priced it at up to $3 million. The vendor has not published a price.' },
    uptime: { label: 'Data Center Knowledge on the Uptime Institute 2026 Global Data Center Survey', url: 'https://www.datacenterknowledge.com/ai-data-centers/ai-drives-data-center-uncertainty-in-uptime-s-2026-survey', says: 'Most commonly reported rack density reached 11 kW; the average excluding sites built for more than 30 kW is 7.8 kW.' },
    microway: { label: 'Microway, rackmount server product page', url: 'https://www.microway.com/products/rackmount-servers/intel-xeon-servers/', says: 'Each system is burn in tested for a minimum of 72 hours before shipment.' },
    gse: { label: 'GSE, server burn in test before production', url: 'https://www.gse.kz/en/blog/server-burn-in-test-before-production', says: 'For typical acceptance, 4 to 12 hours is often enough.' },
    rdpBurn: { label: 'RDP, GPU cluster burn in guide (2026)', url: 'https://rdp.in/gpu-mart/?p=12729', says: 'For GPU clusters, 3 to 7 days of continuous load is the working norm; under 24 hours is a smoke test.' },
    rdpLeak: { label: 'RDP, commissioning a liquid cooled AI rack (2026)', url: 'https://rdp.in/gpu-mart/?p=12732', says: 'Dry pressure decay test held typically 30 to 60 minutes with no measurable drop, before any fluid, then a wet leak inspection.' },
    omron: { label: 'Omron HD-1500 autonomous mobile robot', url: 'https://robotics.omron.com/products/mobile-robots/hd-series/hd-1500/', says: 'Maximum payload 1,500 kg; maximum speed 1.8 m/s.' },
    otto: { label: 'OTTO 1500 spec sheet (Rockwell Automation)', url: 'https://cdn.sanity.io/files/armc7p5y/production/e40f30bcd48679644351b1bcbe483f0462f1b803.pdf', says: 'Maximum capacity 1,900 kg; maximum speed 2.0 m/s.' },
    gigabyte: { label: 'Gigabyte glossary, server manufacturing levels', url: 'https://www.gigabyte.com/glossary/server-manufacturing-levels', says: 'L10 is a complete server, L11 is rack scale integration, L12 is multi rack and cluster integration. L11 can include manifolds, CDUs and leak detection, then validation of flow, pressure, power and cooling.' },
    smcRack: { label: 'Supermicro, rack integration services', url: 'https://www.supermicro.com/en/solutions/rack-integration', says: 'Published stages: assembly (node assembly, rack and stack, networking and power, cabling and labeling), burn in and testing (full rack burn in, test report), delivery (labeling, crating, air ride trucking).' },
    smcCap: { label: 'Supermicro press release, rack scale capacity (2023)', url: 'https://www.supermicro.com/en/pressreleases/supermicro-expands-global-manufacturing-footprint-increasing-worldwide-rack-scale', says: 'Stated worldwide capacity of 5,000 racks per month across several plants, for racks up to 100 kW.' },
  };

  // [key, group, label, unit, default, min, max, step, tag, note, source ids]
  const S = 'sourced', A = 'assumption', X = 'setting';
  const rows = [
    ['demandPerDay', 'Demand and mix', 'Demand (also the target)', 'racks/day', 16, 1, 80, 1, A, 'Sets how fast material arrives and what takt time is. For scale only: one integrator states 5,000 racks/month across several plants.', ['smcCap']],
    ['liquidShare', 'Demand and mix', 'Share of liquid cooled AI racks', 'fraction', 0.2, 0, 1, 0.05, A, '0.2 means 1 rack in 5 is a liquid cooled AI rack.'],
    ['truckBatch', 'Demand and mix', 'Material per delivery', 'racks worth', 8, 1, 40, 1, A, 'One delivery carries parts for this many racks.'],
    ['deliveryJitterPct', 'Demand and mix', 'Delivery timing variation', '+/- %', 40, 0, 90, 5, A, 'Trucks are scheduled evenly but arrive early or late by up to this much.'],
    ['valueAir', 'Demand and mix', 'Value of a standard rack', '$', 250000, 10000, 2000000, 10000, A, 'Placeholder. Used only for WIP dollars.'],
    ['valueLiq', 'Demand and mix', 'Value of an AI rack', '$', 3000000, 100000, 8000000, 100000, S, 'Analyst estimate for a GB200 NVL72 class rack, not a list price.', ['fierce']],

    ['shiftHoursPerDay', 'Shifts', 'Staffed hours per day', 'h', 16, 4, 24, 1, A, '16 = two 8 hour shifts. Test, burn in and AMRs run around the clock regardless.'],
    ['daysPerWeek', 'Shifts', 'Working days per week', 'days', 7, 1, 7, 1, A, ''],

    ['recvDoors', 'Receiving and dock', 'Inbound dock doors', 'doors', 2, 1, 12, 1, A, ''],
    ['recvMin', 'Receiving and dock', 'Unload and receive, fastest', 'min/rack', 20, 1, 240, 1, A, 'Triangular distribution: fastest, typical, slowest.'],
    ['recvMode', 'Receiving and dock', 'Unload and receive, typical', 'min/rack', 30, 1, 240, 1, A, ''],
    ['recvMax', 'Receiving and dock', 'Unload and receive, slowest', 'min/rack', 50, 1, 480, 1, A, ''],
    ['recvBuffer', 'Receiving and dock', 'Dock yard space', 'racks worth', 32, 1, 400, 1, A, 'When the yard is full, deliveries wait at the gate.'],

    ['kitStations', 'Kitting and staging', 'Kitting stations', 'stations', 4, 1, 30, 1, A, ''],
    ['kitMin', 'Kitting and staging', 'Kit one rack, fastest', 'min', 40, 1, 480, 1, A, ''],
    ['kitMode', 'Kitting and staging', 'Kit one rack, typical', 'min', 60, 1, 480, 1, A, ''],
    ['kitMax', 'Kitting and staging', 'Kit one rack, slowest', 'min', 90, 1, 600, 1, A, ''],
    ['kitLiqMult', 'Kitting and staging', 'AI rack time multiplier', 'x', 1.3, 1, 4, 0.1, A, 'More parts: manifolds, hoses, power shelves.'],
    ['kitBuffer', 'Kitting and staging', 'Buffer before kitting', 'racks', 8, 1, 100, 1, A, ''],

    ['asmManual', 'Rack assembly', 'Manual stations', 'stations', 6, 0, 60, 1, A, ''],
    ['asmAuto', 'Rack assembly', 'Automated cells', 'cells', 0, 0, 60, 1, A, 'Set manual to 0 for a fully automated line, or use both for a mix.'],
    ['asmMin', 'Rack assembly', 'Manual assembly, fastest', 'min', 150, 10, 1200, 5, A, 'Mount servers, power, cabling for one standard rack.'],
    ['asmMode', 'Rack assembly', 'Manual assembly, typical', 'min', 210, 10, 1200, 5, A, ''],
    ['asmMax', 'Rack assembly', 'Manual assembly, slowest', 'min', 300, 10, 2400, 5, A, ''],
    ['asmLiqMult', 'Rack assembly', 'AI rack time multiplier', 'x', 1.6, 1, 5, 0.1, A, 'Heavier trays, bus bar, manifolds.'],
    ['asmAutoFactor', 'Rack assembly', 'Automated cell time vs manual', 'x', 0.6, 0.1, 1.5, 0.05, A, '0.6 means a cell takes 60% of the typical manual time, with much less spread.'],
    ['asmManualMtbf', 'Rack assembly', 'Manual station MTBF', 'h', 200, 0, 5000, 10, A, 'Mean time between failures. 0 turns breakdowns off.'],
    ['asmManualMttr', 'Rack assembly', 'Manual station MTTR', 'h', 0.5, 0, 48, 0.1, A, 'Mean time to repair.'],
    ['asmAutoMtbf', 'Rack assembly', 'Automated cell MTBF', 'h', 40, 0, 5000, 5, A, 'Automation stops more often than a person with a torque driver.'],
    ['asmAutoMttr', 'Rack assembly', 'Automated cell MTTR', 'h', 1.5, 0, 48, 0.1, A, ''],
    ['asmBuffer', 'Rack assembly', 'Buffer before assembly', 'racks', 6, 1, 100, 1, A, ''],

    ['leakStations', 'Liquid hookup and leak test', 'Leak test stations', 'stations', 2, 1, 30, 1, A, 'Only AI racks visit this station.'],
    ['leakHookMin', 'Liquid hookup and leak test', 'Hookup, fastest', 'min', 45, 1, 600, 1, A, ''],
    ['leakHookMode', 'Liquid hookup and leak test', 'Hookup, typical', 'min', 60, 1, 600, 1, A, ''],
    ['leakHookMax', 'Liquid hookup and leak test', 'Hookup, slowest', 'min', 90, 1, 900, 1, A, ''],
    ['leakHoldMin', 'Liquid hookup and leak test', 'Pressure hold, shortest', 'min', 30, 0, 240, 5, S, 'Dry pressure decay hold before any fluid.', ['rdpLeak']],
    ['leakHoldMax', 'Liquid hookup and leak test', 'Pressure hold, longest', 'min', 60, 0, 480, 5, S, '', ['rdpLeak']],
    ['leakFpy', 'Liquid hookup and leak test', 'Leak test first pass yield', 'fraction', 0.95, 0.5, 1, 0.01, A, '0.95 means 19 of 20 racks pass the first time.'],
    ['leakBuffer', 'Liquid hookup and leak test', 'Buffer before leak test', 'racks', 3, 1, 100, 1, A, ''],

    ['testPos', 'Functional test', 'Test positions', 'positions', 6, 1, 80, 1, A, 'Runs around the clock.'],
    ['testAirH', 'Functional test', 'Test time, standard rack (mean)', 'h', 3, 0.1, 48, 0.25, A, 'Lognormal distribution.'],
    ['testLiqH', 'Functional test', 'Test time, AI rack (mean)', 'h', 6, 0.1, 72, 0.25, A, ''],
    ['testCv', 'Functional test', 'Test time spread', 'cv', 0.3, 0, 1.5, 0.05, A, 'Coefficient of variation: 0.3 means the typical swing is 30% of the mean.'],
    ['testFpyAir', 'Functional test', 'First pass yield, standard rack', 'fraction', 0.92, 0.5, 1, 0.01, A, ''],
    ['testFpyLiq', 'Functional test', 'First pass yield, AI rack', 'fraction', 0.85, 0.5, 1, 0.01, A, 'More parts and connections, more ways to fail.'],
    ['testMtbf', 'Functional test', 'Test position MTBF', 'h', 150, 0, 5000, 10, A, ''],
    ['testMttr', 'Functional test', 'Test position MTTR', 'h', 2, 0, 48, 0.25, A, ''],
    ['testBuffer', 'Functional test', 'Buffer before test', 'racks', 6, 1, 100, 1, A, ''],

    ['burnBaysA', 'Burn in', 'Zone A bays', 'bays', 24, 1, 400, 1, A, ''],
    ['burnPowerA', 'Burn in', 'Zone A power capacity', 'kW', 2000, 10, 60000, 50, A, 'Hard limit: the racks burning in at once cannot draw more than this.'],
    ['burnCoolA', 'Burn in', 'Zone A liquid cooling capacity', 'kW', 1500, 0, 60000, 50, A, 'Hard limit on the heat the cooling loop can remove from AI racks.'],
    ['burnAirH', 'Burn in', 'Burn in time, standard rack', 'h', 24, 1, 168, 1, A, 'Chosen inside the published range of 4 h to 72 h.', ['gse', 'microway']],
    ['burnLiqH', 'Burn in', 'Burn in time, AI rack', 'h', 48, 1, 240, 1, A, 'Chosen inside the published range of 24 h to 7 days.', ['rdpBurn']],
    ['burnSetupMin', 'Burn in', 'Connect and disconnect', 'min', 30, 0, 240, 5, A, 'Bay is occupied but the rack draws no power.'],
    ['kwAir', 'Burn in', 'Power draw, standard rack', 'kW', 11, 1, 80, 1, S, 'Most commonly reported rack density in a 2026 industry survey.', ['uptime']],
    ['kwLiq', 'Burn in', 'Power draw, AI rack', 'kW', 130, 20, 300, 5, S, 'Vendor sheets give 120 to 135 kW for a GB200 NVL72 class rack.', ['smc', 'hpe']],
    ['burnFpyAir', 'Burn in', 'First pass yield, standard rack', 'fraction', 0.97, 0.5, 1, 0.01, A, ''],
    ['burnFpyLiq', 'Burn in', 'First pass yield, AI rack', 'fraction', 0.93, 0.5, 1, 0.01, A, ''],
    ['burnBuffer', 'Burn in', 'Buffer before burn in', 'racks', 8, 1, 200, 1, A, ''],

    ['repStations', 'Repair loop', 'Repair benches', 'benches', 3, 1, 40, 1, A, ''],
    ['repMeanH', 'Repair loop', 'Repair time (mean)', 'h', 4, 0.1, 72, 0.25, A, 'Lognormal: most repairs are quick, a few are long.'],
    ['repCv', 'Repair loop', 'Repair time spread', 'cv', 0.6, 0, 2, 0.05, A, ''],
    ['repBuffer', 'Repair loop', 'Buffer before repair', 'racks', 6, 1, 100, 1, A, ''],

    ['packStations', 'Final inspection and pack', 'Pack stations', 'stations', 3, 1, 40, 1, A, ''],
    ['packMin', 'Final inspection and pack', 'Inspect and pack, fastest', 'min', 60, 1, 600, 1, A, ''],
    ['packMode', 'Final inspection and pack', 'Inspect and pack, typical', 'min', 90, 1, 600, 1, A, ''],
    ['packMax', 'Final inspection and pack', 'Inspect and pack, slowest', 'min', 150, 1, 900, 1, A, ''],
    ['packLiqMult', 'Final inspection and pack', 'AI rack time multiplier', 'x', 1.3, 1, 4, 0.1, A, 'Heavier crate: an AI rack weighs about 3,000 lb.', ['fierce', 'hpe']],
    ['packBuffer', 'Final inspection and pack', 'Buffer before pack', 'racks', 6, 1, 100, 1, A, ''],

    ['shipDoors', 'Dispatch', 'Outbound dock doors', 'doors', 2, 1, 12, 1, A, ''],
    ['shipMin', 'Dispatch', 'Load one rack, fastest', 'min', 15, 1, 240, 1, A, ''],
    ['shipMode', 'Dispatch', 'Load one rack, typical', 'min', 20, 1, 240, 1, A, ''],
    ['shipMax', 'Dispatch', 'Load one rack, slowest', 'min', 40, 1, 480, 1, A, ''],
    ['shipBuffer', 'Dispatch', 'Finished goods staging', 'racks', 10, 1, 200, 1, A, ''],

    ['amrFleet', 'AMRs', 'AMR fleet size', 'robots', 3, 1, 40, 1, A, 'Every move between stations needs one. Travel time comes from the floor layout. Heavy AMRs carry 1,500 kg or more, enough for a loaded AI rack.', ['omron', 'otto']],
    ['amrSpeedLoaded', 'AMRs', 'Speed carrying a rack', 'm/s', 0.6, 0.1, 2, 0.1, A, 'A tall load of up to 1.4 tonnes moves slowly. Published top speeds for heavy AMRs are 1.8 to 2.0 m/s.', ['omron', 'otto']],
    ['amrSpeedEmpty', 'AMRs', 'Speed when empty', 'm/s', 1.2, 0.1, 2, 0.1, A, 'Kept under the published top speed of 1.8 m/s.', ['omron']],
    ['amrHandleMin', 'AMRs', 'Pick up or set down, fastest', 'min', 1, 0, 30, 0.5, A, 'Align under the rack, lift, check, or the reverse.'],
    ['amrHandleMode', 'AMRs', 'Pick up or set down, typical', 'min', 2, 0, 30, 0.5, A, ''],
    ['amrHandleMax', 'AMRs', 'Pick up or set down, slowest', 'min', 4, 0, 60, 0.5, A, ''],
    ['kitCartTrips', 'AMRs', 'Component cart trips per rack', 'trips', 3, 0, 20, 1, A, 'Carts of servers and parts that follow each rack from kitting to assembly.'],

    ['phase2Day', 'Phase 2', 'Phase 2 comes online on day', 'day of run', 14, 0, 365, 1, X, 'Counted from the end of warm up. Everything below is added on that day.'],
    ['burnBaysB', 'Phase 2', 'Zone B burn in bays', 'bays', 0, 0, 400, 1, A, '0 means there is no phase 2.'],
    ['burnPowerB', 'Phase 2', 'Zone B power capacity', 'kW', 2000, 0, 60000, 50, A, ''],
    ['burnCoolB', 'Phase 2', 'Zone B liquid cooling capacity', 'kW', 1500, 0, 60000, 50, A, ''],
    ['asmManualP2', 'Phase 2', 'Extra manual assembly stations', 'stations', 0, 0, 60, 1, A, ''],
    ['asmAutoP2', 'Phase 2', 'Extra automated cells', 'cells', 0, 0, 60, 1, A, ''],
    ['testPosP2', 'Phase 2', 'Extra test positions', 'positions', 0, 0, 80, 1, A, ''],
    ['packStationsP2', 'Phase 2', 'Extra pack stations', 'stations', 0, 0, 40, 1, A, ''],

    ['warmupDays', 'Experiment', 'Warm up period', 'days', 7, 0, 60, 1, X, 'The line starts empty, which is not normal. Results from these days are thrown away.'],
    ['runDays', 'Experiment', 'Measured run length', 'days', 28, 7, 365, 1, X, ''],
    ['replications', 'Experiment', 'Replications', 'runs', 5, 1, 20, 1, X, 'The same scenario repeated with different random numbers.'],
    ['seed', 'Experiment', 'Random seed', '', 1, 1, 99999, 1, X, 'Same seed, same result. Change it to see a different roll of the dice.'],
  ];

  const SCHEMA = rows.map((r) => ({ key: r[0], group: r[1], label: r[2], unit: r[3], def: r[4], min: r[5], max: r[6], step: r[7], tag: r[8], note: r[9], src: r[10] || [] }));

  function defaults() {
    const p = {};
    for (const s of SCHEMA) p[s.key] = s.def;
    return p;
  }

  // Each scenario is the baseline plus a few changes.
  const SCENARIOS = [
    { id: 'base', name: '1. Baseline', blurb: 'Mostly air cooled: 1 rack in 5 is a liquid cooled AI rack. 16 racks a day.', set: {} },
    { id: 'liquid', name: '2. Mix shifts to AI racks', blurb: 'Same demand, but 4 racks in 5 are now liquid cooled AI racks.', set: { liquidShare: 0.8 } },
    { id: 'double', name: '3. Demand doubles', blurb: 'Material now arrives for 32 racks a day. Nothing else changes.', set: { demandPerDay: 32 } },
    { id: 'bays', name: '4. Add burn in bays', blurb: 'Demand still doubled. Burn in grows from 24 to 48 bays with power and cooling to match. Where does the constraint go?', set: { demandPerDay: 32, burnBaysA: 48, burnPowerA: 4000, burnCoolA: 3000 } },
    { id: 'amr', name: '5. Too few AMRs', blurb: 'The busy line from scenario 4 (demand 32, 48 bays), but the fleet drops from 3 robots to 1.', set: { demandPerDay: 32, burnBaysA: 48, burnPowerA: 4000, burnCoolA: 3000, amrFleet: 1 } },
    { id: 'phase2', name: '6. Phase 2 comes online', blurb: 'Demand of 32 a day from the start. On day 14 a second burn in zone, 6 more assembly stations, 2 more test positions and 1 more pack station come online.', set: { demandPerDay: 32, phase2Day: 14, burnBaysB: 24, asmManualP2: 6, testPosP2: 2, packStationsP2: 1 } },
  ];

  function scenario(id) {
    const s = SCENARIOS.find((x) => x.id === id) || SCENARIOS[0];
    return Object.assign(defaults(), s.set);
  }

  return { SCHEMA, SOURCES, SCENARIOS, defaults, scenario };
});
