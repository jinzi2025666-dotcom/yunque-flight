/** Light-trainer tuning. Distances in meters, angles in radians, mass in kilograms. */
export const MASS = 1040;
export const GRAVITY = 9.81;
export const WING_AREA = 16.6;
export const WING_INCIDENCE = 0.055;
export const CL_ALPHA = 5.15;
export const STALL_AOA = 0.28;
export const CD0 = 0.032;
export const INDUCED_FACTOR = 0.045;
export const AIR_DENSITY = 1.2;
export const MAX_THRUST = 3400;
export const IDLE_RPM = 700;
export const MAX_RPM = 2650;
export const THRUST_FADE_SPEED = 96;
export const GEAR_HEIGHT = 1.55;

/** Light headwind from the north, plus a hint of crosswind from the west. */
export const WIND_X = 0.6;
export const WIND_Z = 2.6;

export const SUN_X = 0.48;
export const SUN_Y = 0.52;
export const SUN_Z = 0.36;

export const FIXED_DT = 1 / 120;
export const MAX_SUBSTEPS = 5;
