======================================================================
NEXUS LIGHTGBM INFERENCE PACKAGE
======================================================================

CONTENTS
----------------------------------------
  lgb_model.txt           Native LightGBM booster (best_iteration only)
  inference_config.json   Full config: parameters, encoders, policies, reference
  feature_generation.py   Exact script that produced the train/val/test Parquet files
  encoder_family.csv      family -> integer label encoding
  encoder_city.csv        city   -> integer label encoding
  encoder_state.csv       state  -> integer label encoding
  encoder_store_type.csv  store type -> integer label encoding
  NEXUS_README.txt        This file

======================================================================
MODEL SPECIFICATIONS
======================================================================

  LightGBM version          : 4.7.0
  Best iteration            : 379  (early stopping on val RMSE, patience=50)
  Training time             : 9.7 seconds
  Number of features        : 56
  Target variable           : daily_family_sales
  Training period           : 2013-01-01 to 2016-11-30  (321,750 rows)
  Validation period         : 2016-12-01 to 2017-05-31  (40,950 rows)
  Test period               : 2017-06-01 to 2017-08-15  (17,100 rows)
  Pilot scope               : 15 stores x 15 product families = 225 series

  Validated performance:
    Val  RMSE : 608.1495
    Test RMSE : 343.1534
    Test MAE  : 156.8989
    Test MASE : 0.4940  (beats naive benchmark by 50.6%)
    Test RMSSE: 0.6622
    Test Bias : +6.3964  (near-zero = well calibrated)

======================================================================
FORECAST HORIZON AND LOOKBACK
======================================================================

  Validated recursive forecast horizon : 76 days
  Minimum historical lookback required : 28 days
    Needed to compute: sales_lag_28, sales_roll_*_28, oil_roll_mean_14

  One-step-ahead  : supply 28+ days of observed history, predict day t+1.
  Multi-step recursive : update lag/rolling buffer with predictions at each step.
  Maintain a rolling buffer of the last 28 actual/predicted sales values per series.

======================================================================
ORDERED FEATURE LIST — 56 features, exact order required for inference
======================================================================

   0  day_of_week
   1  month
   2  quarter
   3  day_of_month
   4  year
   5  day_of_year
   6  is_weekend
   7  is_month_start
   8  is_month_end
   9  is_payday
  10  is_holiday
  11  is_event
  12  is_additional
  13  is_bridge
  14  is_work_day
  15  is_transferred
  16  is_national_event
  17  is_regional_event
  18  is_local_event
  19  oil_price
  20  cluster
  21  has_perishable
  22  city_enc
  23  state_enc
  24  store_type_enc
  25  family_enc
  26  sales_lag_1
  27  sales_lag_2
  28  sales_lag_3
  29  sales_lag_7
  30  sales_lag_14
  31  sales_lag_28
  32  sales_roll_mean_7
  33  sales_roll_std_7
  34  sales_roll_median_7
  35  sales_roll_min_7
  36  sales_roll_max_7
  37  sales_roll_mean_14
  38  sales_roll_std_14
  39  sales_roll_median_14
  40  sales_roll_min_14
  41  sales_roll_max_14
  42  sales_roll_mean_28
  43  sales_roll_std_28
  44  sales_roll_median_28
  45  sales_roll_min_28
  46  sales_roll_max_28
  47  sales_ewm_7
  48  zero_days_past_7
  49  oil_roll_mean_7
  50  oil_roll_mean_14
  51  transactions
  52  avg_item_sales_lag1
  53  num_items_sold_lag1
  54  num_records_lag1
  55  num_classes_lag1

======================================================================
LABEL ENCODERS (fitted on training data only)
======================================================================

  family_enc:
    BEVERAGES                 -> 0
    BREAD/BAKERY              -> 1
    CLEANING                  -> 2
    DAIRY                     -> 3
    DELI                      -> 4
    EGGS                      -> 5
    FROZEN FOODS              -> 6
    GROCERY I                 -> 7
    HOME CARE                 -> 8
    LIQUOR,WINE,BEER          -> 9
    MEATS                     -> 10
    PERSONAL CARE             -> 11
    POULTRY                   -> 12
    PREPARED FOODS            -> 13
    PRODUCE                   -> 14

  city_enc:
    Ambato                    -> 0
    Cayambe                   -> 1
    Guayaquil                 -> 2
    Quito                     -> 3

  state_enc:
    Guayas                    -> 0
    Pichincha                 -> 1
    Tungurahua                -> 2

  store_type_enc:
    A                         -> 0
    B                         -> 1
    D                         -> 2

======================================================================
FUTURE COVARIATE POLICY
======================================================================

  oil_price
    Forward-fill from last known observed price.
    oil_roll_mean_7 and oil_roll_mean_14: compute from filled series,
    using shift(1)+rolling so window covers [t-w, t-1].

  transactions
    Use store-specific weekday median from training observed rows (105 groups).
    Set transactions_missing = 1 for all future-period rows.
    Do NOT use val or test period transaction actuals.

  is_holiday / is_event / is_national_event / is_regional_event /
  is_local_event / is_additional / is_bridge / is_work_day / is_transferred
    All 9 are future-known (Ecuador official holiday calendar).
    Populate in advance for the entire forecast horizon.

  Calendar features
    Fully deterministic. Compute directly from the forecast date:
    day_of_week, month, quarter, day_of_month, year, day_of_year,
    is_weekend, is_month_start, is_month_end, is_payday.

  avg_item_sales_lag1 / num_items_sold_lag1 / num_records_lag1 / num_classes_lag1
    All carry _lag1 — use PREVIOUS day's values only.
    For day t: use actual item-aggregate values from day t-1.
    Never use same-day item-level data (contemporaneous leakage).
    For periods beyond training, use rolling mean of last 7 observed values.

  sales_lag_1 / sales_lag_2 / sales_lag_3 / sales_lag_7 / sales_lag_14 / sales_lag_28
    First prediction: use actual observed history (minimum 28 days required).
    Recursive steps: use previously predicted values to fill buffer.

  sales_roll_mean/std/median/min/max over 7/14/28 days
  sales_ewm_7 / zero_days_past_7 / oil_roll_mean_7 / oil_roll_mean_14
    All computed with shift(1) — window always covers [t-window, t-1].
    For recursive forecast: recompute from the rolling prediction buffer.

======================================================================
REFERENCE PREDICTION — backend validation before activation
======================================================================

  Series   : Store 44 | GROCERY I
  Date     : 2017-06-01  (first day of test period)
  Actual   : 9008.00 units
  Predicted: 8352.4537 units
  Abs Error: 655.5463 units
  Tolerance: predicted should be within ±50 of 8352.45

  Complete ordered feature row:
  #    Feature                          Value
  -------------------------------------------------------
   0  day_of_week                      4.0
   1  month                            6.0
   2  quarter                          2.0
   3  day_of_month                     1.0
   4  year                             2017.0
   5  day_of_year                      152.0
   6  is_weekend                       0.0
   7  is_month_start                   1.0
   8  is_month_end                     0.0
   9  is_payday                        0.0
  10  is_holiday                       0.0
  11  is_event                         0.0
  12  is_additional                    0.0
  13  is_bridge                        0.0
  14  is_work_day                      0.0
  15  is_transferred                   0.0
  16  is_national_event                0.0
  17  is_regional_event                0.0
  18  is_local_event                   0.0
  19  oil_price                        48.32
  20  cluster                          5.0
  21  has_perishable                   0.0
  22  city_enc                         3.0
  23  state_enc                        1.0
  24  store_type_enc                   0.0
  25  family_enc                       7.0
  26  sales_lag_1                      9829.0
  27  sales_lag_2                      7643.0
  28  sales_lag_3                      8383.0
  29  sales_lag_7                      7175.0
  30  sales_lag_14                     7207.0
  31  sales_lag_28                     7437.0
  32  sales_roll_mean_7                10553.714285714286
  33  sales_roll_std_7                 2996.9132294348965
  34  sales_roll_median_7              9829.0
  35  sales_roll_min_7                 7175.0
  36  sales_roll_max_7                 14094.0
  37  sales_roll_mean_14               10572.714285714286
  38  sales_roll_std_14                3251.0147393029206
  39  sales_roll_median_14             9239.0
  40  sales_roll_min_14                7175.0
  41  sales_roll_max_14                17194.0
  42  sales_roll_mean_28               10557.214285714286
  43  sales_roll_std_28                3047.180510487041
  44  sales_roll_median_28             9678.5
  45  sales_roll_min_28                7004.0
  46  sales_roll_max_28                17194.0
  47  sales_ewm_7                      10050.68723768836
  48  zero_days_past_7                 0.0
  49  oil_roll_mean_7                  49.25857142857143
  50  oil_roll_mean_14                 49.86071428571428
  51  transactions                     4165.0
  52  avg_item_sales_lag1              10.75382932166302
  53  num_items_sold_lag1              914.0
  54  num_records_lag1                 914.0
  55  num_classes_lag1                 55.0

======================================================================
HOW TO LOAD AND RUN INFERENCE
======================================================================

  import lightgbm as lgb
  import numpy as np

  # Load the booster
  booster = lgb.Booster(model_file='lgb_model.txt')

  # Build feature array — 56 values in exact order above, shape (1, 56)
  X = np.array([[...56 values...]], dtype=np.float32)

  # Predict and clip (sales cannot be negative)
  prediction = float(np.clip(booster.predict(X), 0, None)[0])

  # Validate against reference row:
  # Expected output for Store 44 / GROCERY I / 2017-06-01: ~8352.45

  # Batch inference (N rows):
  # X_batch shape = (N, 56)
  # predictions = np.clip(booster.predict(X_batch), 0, None)

======================================================================
END OF NEXUS README
======================================================================