// Canonical BMW Federal Drive Cycle phases (consensus from E46/M3 service refs).
// Times are in seconds. Speed ranges in MPH. RPM cap enforced globally.
window.DRIVE_CYCLE_PHASES = [
  {
    id: "cold_start",
    number: 1,
    name: "Cold Start",
    short: "KEY ON · DO NOT MOVE",
    duration: 15, // 15s acknowledgement — engine on, no movement
    target: { type: "stationary", label: "VEHICLE STATIONARY" },
    speedRange: [0, 0],
    rpm: "Idle (~700 RPM)",
    instruction: "Start a fully cold engine. Do not blip throttle. Keep foot off accelerator.",
    conditions: ["Engine off ≥ 8 hrs", "Coolant temp = ambient", "Fuel 1/4 – 3/4 tank", "A/C OFF", "Headlights OFF"],
    voice: "Begin cold start. Start the engine and keep the vehicle stationary.",
  },
  {
    id: "idle_warmup",
    number: 2,
    name: "Idle Warm-Up",
    short: "IDLE IN PARK",
    duration: 180, // 3 minutes
    target: { type: "stationary", label: "IDLE IN PARK / NEUTRAL" },
    speedRange: [0, 0],
    rpm: "Idle only",
    instruction: "Hold in Park or Neutral. Do not touch the throttle. Let the ECU run secondary air and warm O2 heaters.",
    conditions: ["Gear: Park / Neutral", "Foot off throttle", "A/C OFF", "No accessory load"],
    voice: "Idle in park for three minutes. Do not touch the throttle.",
  },
  {
    id: "city_cruise",
    number: 3,
    name: "City Cruise",
    short: "STEADY 20–30 MPH",
    duration: 240, // 4 minutes
    target: { type: "speed", min: 20, max: 30, label: "HOLD 20–30 MPH" },
    speedRange: [20, 30],
    rpm: "Keep under 3000 RPM",
    instruction: "Accelerate gently to 20–30 MPH. Hold a steady speed. Avoid stops, hard throttle, or shifting above 3000 RPM.",
    conditions: ["Steady throttle", "RPM < 3000", "No full stops", "No hard braking"],
    voice: "Accelerate gently to between 20 and 30 miles per hour. Hold steady.",
  },
  {
    id: "highway_cruise",
    number: 4,
    name: "Highway Cruise",
    short: "STEADY 40–55 MPH",
    duration: 900, // 15 minutes
    target: { type: "speed", min: 40, max: 55, label: "HOLD 40–55 MPH" },
    speedRange: [40, 55],
    rpm: "Keep under 3000 RPM",
    instruction: "Accelerate to 40–55 MPH and hold. Use cruise control if possible. This phase sets the Catalyst Monitor.",
    conditions: ["Cruise control ON", "RPM < 3000", "Speed ≤ 60 MPH", "No stops", "Flat, open road"],
    voice: "Accelerate to between 40 and 55 miles per hour. Engage cruise control if available.",
  },
  {
    id: "decel",
    number: 5,
    name: "Coast Down",
    short: "LIFT · NO BRAKE",
    duration: 30,
    target: { type: "decel", max: 55, label: "COAST FROM 55 MPH" },
    speedRange: [0, 55],
    rpm: "Engine braking only",
    instruction: "Lift off the throttle completely. Coast down without touching the brake. Let engine braking slow the car.",
    conditions: ["No throttle", "No brake pedal", "Clutch engaged / in gear"],
    voice: "Release the throttle. Coast down without braking.",
  },
  {
    id: "cool_idle",
    number: 6,
    name: "Cool-Down Idle",
    short: "IDLE 5 MIN · THEN KEY OFF",
    duration: 300, // 5 minutes
    target: { type: "stationary", label: "IDLE IN PARK" },
    speedRange: [0, 0],
    rpm: "Idle only",
    instruction: "Come to a stop. Place in Park or Neutral and idle for 5 minutes. The EVAP leak test may run after key-off.",
    conditions: ["Gear: Park / Neutral", "Do not rev", "Key remains ON until timer ends"],
    voice: "Idle for five minutes, then switch the engine off.",
  },
];

window.DRIVE_CYCLE_RULES = {
  maxRpm: 3000,
  maxSpeedMph: 60,
  // Violations that auto-restart the phase
  violations: {
    overRpm: "RPM EXCEEDED 3000",
    overSpeed: "SPEED EXCEEDED 60 MPH",
    outOfBand: "SPEED OUT OF RANGE",
    brakedInDecel: "BRAKE USED DURING COAST",
    moved: "VEHICLE MOVED",
  },
};
