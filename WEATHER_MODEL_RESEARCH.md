# Weather × Home Runs — Research Brief

Foundation for a physics-grounded HR weather model. All coefficients cited with sources. Use this as the spec for rebuilding `environment.py`.

## 1. The one physical truth

Weather affects HRs through **air density** ρ and **wind relative velocity**. Everything else is a second-order correction.

`F_drag = ½ · ρ · v² · C_d · A`

Drag dominates over Magnus lift for HR-profile balls (100 mph EV, 28-30° LA, 2,500 rpm backspin). **Lower density → less drag → more carry.**

Three independent channels move air density:
- Temperature (hot → less dense)
- Pressure (low → less dense; includes altitude)
- Humidity (humid → less dense — water vapor 18 g/mol vs dry air 29 g/mol)

Wind is separate: adds/subtracts from ball velocity relative to air.

## 2. Coefficients (Nathan et al., Statcast, Weather Applied Metrics)

Reference trajectory: EV 100 mph, LA 29°, 2,500 rpm, sea level, 70°F, ~397 ft carry.

| Variable | Carry (ft/unit) | HR rate (% per unit) |
|---|---|---|
| Temperature | +0.33 ft/°F | ~+1% / °F |
| Altitude | +6 ft / 1000 ft | ~+1% / 800 ft |
| Pressure | +6.7 ft / inHg drop | backtest needed |
| Humidity | +1 ft / 50% RH (small) | <1% / 50% RH |
| Tailwind (out to CF) | +3.2 ft / mph | ~+0.8% / mph distance, ~+2% / mph HR rate (fence-crossing amplification) |
| Headwind | -3.4 ft / mph | same scale, negative |
| Crosswind | ~0 ft | negligible on carry |
| Roof closed | +1% distance | +1% |
| Ball C_d (intrinsic) | -3% C_d → +5 ft → +15% HR | year-level |

Air density formulas (use these exactly):

```
ρ = (P_d · M_d + P_v · M_v) / (R · T)       # humid-air density, kg/m³
P_v = (RH/100) · P_sat(T_C)                  # Arden Buck saturation pressure
P_sat(T_C) = 6.1121 · exp((18.678 − T_C/234.5) · (T_C / (257.14 + T_C)))  # hPa
P_d = P_station − P_v

M_d = 28.965 g/mol
M_v = 18.016 g/mol
R   = 8.31446 J/(mol·K)
```

**ICAO barometric formula** (altitude → pressure; use station pressure, not QNH):

`P(h) = P₀ · (1 − 0.0065·h / 288.15)^5.2561`

Denver (~1600m) ≈ 0.82 × sea level. Matches Nathan's Coors measurement.

## 3. Wind projection — the right way

Weather APIs report wind **from** a direction. Convert to vector **to which** it blows:
- `w_x = -|w| · sin(w_dir · π/180)`
- `w_y = -|w| · cos(w_dir · π/180)`

Project onto the park's HP → CF axis (bearing β):
- `cf_x = sin(β · π/180)`
- `cf_y = cos(β · π/180)`
- `w_out = w_x·cf_x + w_y·cf_y = |w| · cos(θ)` (tailwind positive)

**Height correction:** weather stations measure at 10m; ball peaks at 25-40m. Log profile:
- `u(30m) / u(10m) ≈ 1.19`
- Apply 1.15-1.25 scalar; 1.19 is a safe default.

**CF bearings need to be per-park.** Rough values (verify from Google Maps azimuth of HP→CF per park):
- Most parks: 0°-90° (N to E)
- Wrigley: ~30°
- Fenway: ~45°
- Yankee Stadium: ~75°
- Oracle: ~75° (swirling coastal — low wind correlation)

**Crosswinds:** skip them. They barely affect HR carry (<2% at 20 mph).

## 4. Recommended model — replace the current ad-hoc formula

Target output: a single multiplier `E` on the base HR probability.

```python
E = E_density · E_wind · E_ball · E_park_residual
```

### E_density

Replaces temp + pressure + humidity + altitude terms with one physics-consistent term:

```
E_density = (ρ_ref / ρ_game) ^ k_ρ
ρ_ref = 1.225 kg/m³    # sea level, 59°F, dry
k_ρ   ≈ 2.5            # starting value — calibrate via backtest
```

Justification of k_ρ ≈ 2.5: Coors ρ/ρ₀ ≈ 0.82 should yield +25% HR (matches pre-humidor observation). `(1/0.82)^k = 1.25 → k = ln(1.25)/ln(1/0.82) ≈ 2.5`.

**DO NOT** also add separate temp/pressure/altitude/humidity regressors — they're already inside ρ. Collinearity will blow up any regression.

### E_wind

```
w_out   = |w| · cos(θ_wind_to_CF)        # signed, + = tailwind
w_adj   = w_out · 1.19                    # 10m → 30m
E_wind  = 1 + k_wind · w_adj / EV_ref
EV_ref  = 100 mph
k_wind  ≈ 0.6-0.8 for distance; ≈ 2.0 for HR rate — backtest
```

### E_ball (year-level drag residual)

Post-2016 ball was juiced (~3% lower C_d → +15% HR). Post-2021 deadened. Treat as a year fixed effect; calibrate from Savant's published yearly ball-drag metrics.

### E_park_residual

Captures wall height, foul territory, coast proximity, humidor effect:

```
E_park_residual = park_HR_factor / E_density_typical_for_park
```

Divide out the portion already explained by density so we don't double-count Coors altitude.

## 5. What public HR models get wrong

1. Collapse wind to 3 buckets (out/in/cross) — loses 50%+ of the signal that vector projection preserves.
2. Use RH directly instead of converting to dew point or vapor pressure.
3. Double-count altitude (station pressure already contains altitude).
4. Forget the 10m → 30m wind height correction.
5. No ball-year drag residual (misses the 2019 surge, 2021 deadening).
6. Treat humidor effect at Coors/Chase as independent from park factor.

We can beat most of them just by doing the physics correctly.

## 6. Data sources

### Forecast (game-day)
**Stay on Open-Meteo** (https://open-meteo.com). Free, 10k calls/day, covers all 30 parks + Toronto/Mexico City, pulls from ECMWF IFS + NOAA GFS/HRRR + DWD ICON + Météo-France. Paid vendors rebrand these same models.

### Historical (backtesting 2023-2025)
Open-Meteo's historical endpoint is ERA5 reanalysis — smoothed, low-resolution over waterfront parks (Wrigley, Oracle). **Add Iowa State ASOS METAR archive** (https://mesonet.agron.iastate.edu/) for backtesting. It's the actual hourly airport observation — the ground truth meteorologists use. Free, bulk download per station per year.

Mapping stadiums → METAR stations (major ones):
- Wrigley → KORD (Chicago O'Hare, 14 mi)
- Yankee Stadium → KLGA (LaGuardia)
- Fenway → KBOS (Logan)
- Oracle → KSFO
- Dodger → KBUR (Burbank) or KLAX
- Coors → KDEN
- Toronto → CYYZ
- Mexico City → MMMX

Caveat: airport is usually 5-15 mi from stadium. Wind differs at waterfront parks (lake/bay breezes). Best we can do without proprietary in-park sensors.

### Paid fallback (not needed now)
WeatherAPI.com Pro+ $25/mo if we ever need redundant forecast source. Historical goes back to 2010. Not urgent.

## 7. Open questions (backtesting will answer)

1. Real k_ρ for HR rate (not distance) — start 2.5, fit from data
2. Real k_wind — noisy because box-score wind varies by measurement location
3. Is 1.19 height correction right per park, or park-specific?
4. Should we split wind projection by batter handedness (LHB → RF, RHB → LF axis)?
5. Does precipitation suppress HRs independently of density? (Literature thin)
6. Humidor standardization post-2022 — do all parks now store balls at regulated RH?
7. Reported dome temps — outdoor reading or in-stadium?

## Key sources

- **Alan Nathan — Physics of Baseball**: https://baseball.physics.illinois.edu/
- **Carry of a Fly Ball**: https://baseball.physics.illinois.edu/carry.html
- **Effect of Temperature on HR Production**: https://baseball.physics.illinois.edu/HRProbTemp.pdf
- **Fly Ball Carry and the HR Surge** (Hardball Times): https://tht.fangraphs.com/fly-ball-carry-and-the-home-run-surge/
- **The Physics of Which Way the Wind Blows** (Hardball Times): https://tht.fangraphs.com/the-physics-of-which-way-the-wind-blows/
- **Impact of Atmosphere on HR Ball** (Weather Applied Metrics): https://blog.weatherapplied.com/impact-of-atmosphere-home-run-ball/
- **Weather Applied Metrics in MLB** (MLB Tech): https://technology.mlblogs.com/weather-applied-metrics-in-major-league-baseball-aa0e556eb49f
- **The Big Impact of Wind** (MLB.com): https://www.mlb.com/news/the-big-impact-of-wind-on-baseball-outcomes
- **Statcast Park Factors methodology**: https://www.mlb.com/news/park-factors-measured-by-statcast
- **Ballpark Orientations** (CS Wisconsin): https://pages.cs.wisc.edu/~naze/ballparks/
- **Density of Air — Wikipedia**: https://en.wikipedia.org/wiki/Density_of_air
- **Arden Buck Equation — Wikipedia**: https://en.wikipedia.org/wiki/Arden_Buck_equation
- **Iowa State ASOS archive**: https://mesonet.agron.iastate.edu/
