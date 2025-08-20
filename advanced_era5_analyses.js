/**** =====================================================================
 * ERA5 Monthly Aggregates — AOI Climate Processor
 * Author: Observatorio Nacional de la Crisis Climática
 * Description:
 *   - Loads ERA5 Monthly Aggregates and extracts climate variables
 *   - Converts units (precip mm, temps °C)
 *   - Builds monthly climatologies (mean/median across years)
 *   - Exports monthly rasters to Google Drive
 *   - Produces monthly “histogram” bar charts and annual time series w/ trendlines
 *   - Interactive map to browse monthly climatologies
 *
 * Dataset: ECMWF/ERA5/MONTHLY
 * Bands used:
 *   total_precipitation (m)       -> tp_mm
 *   mean_2m_air_temperature (K)   -> tmean_C
 *   minimum_2m_air_temperature(K) -> tmin_C
 *   maximum_2m_air_temperature(K) -> tmax_C
 *   u_component_of_wind_10m       -> u10  (m s-1)
 *   v_component_of_wind_10m       -> v10  (m s-1)
 * ===================================================================== **/


// ========================== USER PARAMETERS =============================

// 1) AOI asset (FeatureCollection or Geometry). Replace with your asset ID.
var AOI_ASSET_ID = "projects/ee-franklinparedes75/assets/Cojedes_Guarico";	// <-- EDIT THIS

// 2) Analysis years (inclusive)
var START_YEAR = 1990;  // <-- EDIT THIS
var END_YEAR   = 2020;  // <-- EDIT THIS

// 3) Averaging metric for monthly climatology across years: 'mean' or 'median'
var AVERAGING_METRIC = 'mean'; // <-- EDIT THIS

// 4) Google Drive folder for exports
var DRIVE_FOLDER = 'EE_ERA5_Monthly';

// 5) Resampling for outcomes
var nativeScale = 5000; // // nativeScale native ERA5 = 27830 m; change if you need

// Optional: default map zoom level (after centering on AOI)
var MAP_ZOOM = 6;

// ============================ COLOR CONSTANTS =============================
var COLOR_MONTHLY = {
  tp:    '#2c5fdf', // Total Precipitation
  tmean: '#facf45', // Average Air Temperature
  tmin:  '#00d5d5', // Minimum Air Temperature
  tmax:  '#f44336'  // Maximum Air Temperature
};
var COLOR_TREND = '#a71930'; // Annual trend line color

// ============================ UTILITIES =================================

/**
 * Pads month number to two digits.
 * @param {number} m - month 1..12
 * @return {string}
 */
function pad2(m) { return (m < 10 ? '0' : '') + m; }

/**
 * Month names (short).
 */
var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var MONTH_NAMES_EE = ee.List(MONTH_NAMES);

/**
 * Try to load AOI geometry from an asset (FeatureCollection or Geometry).
 * @param {string} assetId
 * @return {ee.Geometry}
 */
function loadAOIGeometry(assetId) {
  // Most AOIs are FeatureCollections. If your asset is a single Feature or Geometry,
  // this still works: casting to FeatureCollection will wrap it.
  var fc = ee.FeatureCollection(assetId);
  return fc.geometry();
}

/**
 * Safe center on geometry (with fallback for small areas).
 */
function centerOn(geom, zoom) {
  // If geom is extremely small, centerObject may zoom too far; clamp zoom.
  Map.centerObject(geom, zoom || MAP_ZOOM);
}

/**
 * Get reducer for climatology based on user metric.
 * @return {'mean'|'median'}
 */
function getClimMetric() {
  var metric = ('' + AVERAGING_METRIC).toLowerCase();
  return (metric === 'median') ? 'median' : 'mean';
}

/**
 * Build a monthly climatology (12 images) for a single band from an ImageCollection.
 * Each output image has a "month" (1..12) property and the same band name.
 * @param {ee.ImageCollection} ic - source collection
 * @param {string} band - band name to composite
 * @param {'mean'|'median'} metric - averaging metric across years
 * @return {ee.ImageCollection} 12 images, one per calendar month
 */
function monthlyClimatology(ic, band, metric) {
  var months = ee.List.sequence(1, 12);
  var imgs = months.map(function(m) {
    m = ee.Number(m);
    var mcol = ic
      .filter(ee.Filter.calendarRange(m, m, 'month'))
      .select([band]);
  var composite;
  if (metric === 'median') {
  composite = mcol.median();
  } else {
  composite = mcol.mean();
  }
var img = composite.rename(band)
 .set('month', m)
 .set('band', band)
 .set('metric', metric);;
    return img;
  });
  return ee.ImageCollection(imgs);
}

/**
 * Compute annual aggregation for a band across months within each year.
 * For precipitation: 'sum' (annual total). For temperatures: 'mean' (annual mean).
 * Returns FeatureCollection with properties: {year, value}.
 * @param {ee.ImageCollection} ic - source (already unit-converted & renamed)
 * @param {string} band
 * @param {'sum'|'mean'} method
 * @param {ee.Geometry} region
 * @param {number} scale
 * @return {ee.FeatureCollection}
 */
function annualSeries(ic, band, method, region, scale) {
  var years = ee.List.sequence(START_YEAR, END_YEAR);
  var feats = years.map(function(y) {
    y = ee.Number(y);
    var ycol = ic.filter(ee.Filter.calendarRange(y, y, 'year')).select([band]);
    var yimg = ee.Image(ee.Algorithms.If(
      method === 'sum', ycol.sum(), ycol.mean()
    )).rename(band);
    var val = ee.Number(
      yimg.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: region,
        scale: scale,
        bestEffort: true,
        maxPixels: 1e13
      }).get(band)
    );
    return ee.Feature(null, {'year': y, 'value': val});
  });
  return ee.FeatureCollection(feats);
}

/**
 * Build a FeatureCollection of 12 monthly values over region for a single-band
 * monthly climatology (12 images), to draw a bar chart.
 * @param {ee.ImageCollection} monthlyIC - 12 images w/ 'month' property
 * @param {string} band
 * @param {ee.Geometry} region
 * @param {number} scale
 * @return {ee.FeatureCollection}
 */
function monthlyValuesForChart(monthlyIC, band, region, scale) {
  var months = ee.List.sequence(1, 12);
  var feats = months.map(function(m) {
    m = ee.Number(m);
    var img = ee.Image(
      monthlyIC.filter(ee.Filter.eq('month', m)).first()
    ).select([band]);
    var val = ee.Number(img.reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: region,
      scale: scale,
      bestEffort: true,
      maxPixels: 1e13
    }).get(band));
    var label = ee.String(MONTH_NAMES_EE.get(m.subtract(1)));
    return ee.Feature(null, {'month': m, 'label': label, 'value': val});
  });
  return ee.FeatureCollection(feats);
}

// ========================= LOAD DATA & PREP ==============================

// AOI
var AOI = loadAOIGeometry(AOI_ASSET_ID);
centerOn(AOI, MAP_ZOOM);

// Date range
var startDate = ee.Date.fromYMD(START_YEAR, 1, 1);
var endDate   = ee.Date.fromYMD(END_YEAR, 12, 31);

// ERA5 Monthly collection and bands we need
var ERA5 = ee.ImageCollection('ECMWF/ERA5/MONTHLY')
  .filterDate(startDate, endDate.advance(1, 'day'))
  .select([
    'total_precipitation',
    'mean_2m_air_temperature',
    'minimum_2m_air_temperature',
    'maximum_2m_air_temperature',
    'u_component_of_wind_10m',
    'v_component_of_wind_10m'
  ]);

// Unit conversions + rename for clarity
var ERA5x = ERA5.map(function(img) {
  var tp_mm = img.select('total_precipitation').multiply(1000).rename('tp_mm');      // m -> mm
  var tmean = img.select('mean_2m_air_temperature').subtract(273.15).rename('tmean_C');
  var tmin  = img.select('minimum_2m_air_temperature').subtract(273.15).rename('tmin_C');
  var tmax  = img.select('maximum_2m_air_temperature').subtract(273.15).rename('tmax_C');
  var u10   = img.select('u_component_of_wind_10m').rename('u10');
  var v10   = img.select('v_component_of_wind_10m').rename('v10');
  // Keep time_start for calendaring
  return ee.Image.cat([tp_mm, tmean, tmin, tmax, u10, v10])
           .copyProperties(img, ['system:time_start']);
});

// Use native ERA5 pixel scale
// var nativeScale = ee.Image(ERA5x.first()).projection().nominalScale();

// ===================== MONTHLY CLIMATOLOGIES (12) ========================

var metric = getClimMetric();

var climTP    = monthlyClimatology(ERA5x, 'tp_mm',   metric);
var climTmean = monthlyClimatology(ERA5x, 'tmean_C', metric);
var climTmin  = monthlyClimatology(ERA5x, 'tmin_C',  metric);
var climTmax  = monthlyClimatology(ERA5x, 'tmax_C',  metric);

// (Wind components are loaded/converted above and available if needed)
// var climU10 = monthlyClimatology(ERA5x, 'u10', metric);
// var climV10 = monthlyClimatology(ERA5x, 'v10', metric);

// ============================== EXPORTS ===================================
/**
 * Create Drive export tasks for each month for a given monthly climatology
 * (12 images). Images are clipped to AOI.
 * @param {ee.ImageCollection} monthlyIC
 * @param {string} band
 * @param {string} varLabel - e.g., 'TPmm', 'TmeanC', ...
 */
function exportMonthlyRasters(monthlyIC, band, varLabel) {
  for (var m = 1; m <= 12; m++) {
    var img = ee.Image(
      monthlyIC.filter(ee.Filter.eq('month', m)).first()
    ).select([band]).clip(AOI);

    var fileBase = [
      'ERA5_', varLabel, '_', metric,
      '_', START_YEAR, '-', END_YEAR,
      '_M', pad2(m)
    ].join('');

    Export.image.toDrive({
      image: img,
      description: fileBase,
      folder: DRIVE_FOLDER,
      fileNamePrefix: fileBase,
      region: AOI,
      scale: nativeScale,   
      maxPixels: 1e13
    });
  }
}

// Trigger export task creation (comment out any you don’t want)
exportMonthlyRasters(climTP,    'tp_mm',   'TPmm');
exportMonthlyRasters(climTmean, 'tmean_C', 'TmeanC');
exportMonthlyRasters(climTmin,  'tmin_C',  'TminC');
exportMonthlyRasters(climTmax,  'tmax_C',  'TmaxC');
// If desired (optional):
// exportMonthlyRasters(climU10,   'u10',     'U10');
// exportMonthlyRasters(climV10,   'v10',     'V10');


// ============================== CHARTS ====================================

// ---- Monthly “histogram” (bar) charts: monthly climatological values ----

function drawMonthlyBarChart(monthlyIC, band, title, yLabel, colorHex) {
  var fc = monthlyValuesForChart(monthlyIC, band, AOI, nativeScale);
  var chart = ui.Chart.feature.byFeature({
    features: fc,
    xProperty: 'label',
    yProperties: ['value']
  })
  .setChartType('ColumnChart')
  .setOptions({
    title: title + ' (' + START_YEAR + '–' + END_YEAR + ', ' + metric + ')',
    legend: { position: 'none' },
    hAxis: { title: 'Month' },
    vAxis: { title: yLabel },
    bar: { groupWidth: '80%' },
    colors: [colorHex]  // <-- set bar color
  });
  return chart;
}

// Monthly “histogram” (bar) charts
var chartMonthlyTP    = drawMonthlyBarChart(climTP,    'tp_mm',
  'Total Precipitation (Monthly)', 'mm',  COLOR_MONTHLY.tp);
var chartMonthlyTmean = drawMonthlyBarChart(climTmean, 'tmean_C',
  'Average Air Temperature (Monthly)', '°C', COLOR_MONTHLY.tmean);
var chartMonthlyTmin  = drawMonthlyBarChart(climTmin,  'tmin_C',
  'Minimum Air Temperature (Monthly)', '°C', COLOR_MONTHLY.tmin);
var chartMonthlyTmax  = drawMonthlyBarChart(climTmax,  'tmax_C',
  'Maximum Air Temperature (Monthly)', '°C', COLOR_MONTHLY.tmax);

// ---- Annual time series with trend lines ----

function drawAnnualLineChart(ic, band, method, title, yLabel, trendColor) {
  var fc = annualSeries(ic, band, method, AOI, nativeScale);
  var chart = ui.Chart.feature.byFeature({
    features: fc,
    xProperty: 'year',
    yProperties: ['value']
  })
  .setChartType('LineChart')
  .setOptions({
    title: title + ' (' + START_YEAR + '–' + END_YEAR + ')',
    hAxis: { title: 'Year', format: '####' },
    vAxis: { title: yLabel },
    pointSize: 3,
    lineWidth: 2,
    trendlines: {
      0: {
        type: 'linear',
        color: trendColor,   // <-- set trend line color
        lineWidth: 3,
        showR2: true,
        visibleInLegend: true
      }
    }
  });
  return chart;
}


// Use ERA5x (monthly) as input; aggregation happens within annualSeries()

// Annual time series (trend line color only)
var chartAnnualTP    = drawAnnualLineChart(ERA5x, 'tp_mm',   'sum',
  'Annual Total Precipitation', 'mm',  COLOR_TREND);
var chartAnnualTmean = drawAnnualLineChart(ERA5x, 'tmean_C', 'mean',
  'Annual Average Air Temperature', '°C', COLOR_TREND);
var chartAnnualTmin  = drawAnnualLineChart(ERA5x, 'tmin_C',  'mean',
  'Annual Average Minimum Air Temperature', '°C', COLOR_TREND);
var chartAnnualTmax  = drawAnnualLineChart(ERA5x, 'tmax_C',  'mean',
  'Annual Average Maximum Air Temperature', '°C', COLOR_TREND);


// ============================ MAP UI ======================================

// Simple palettes
var PALETTE_BLUES = ['f7fbff','deebf7','c6dbef','9ecae1','6baed6','4292c6','2171b5','08519c','08306b'];
var PALETTE_TEMP  = ['313695','4575b4','74add1','abd9e9','e0f3f8','ffffbf','fee090','fdae61','f46d43','d73027','a50026'];

// Visualization params (tweak ranges to your climate/region)

var VIZ = {
  tp_mm:   {min: 0,   max: 800, palette: PALETTE_BLUES},  // monthly totals (mm)
  tmean_C: {min: -20, max: 35,  palette: PALETTE_TEMP},
  tmin_C:  {min: -40, max: 25,  palette: PALETTE_TEMP},
  tmax_C:  {min: -5,  max: 45,  palette: PALETTE_TEMP}
};

var VAR_TO_IC = {
  'Total Precipitation (mm)': climTP,
  'Avg Air Temp (°C)':        climTmean,
  'Min Air Temp (°C)':        climTmin,
  'Max Air Temp (°C)':        climTmax
};
var VAR_TO_BAND = {
  'Total Precipitation (mm)': 'tp_mm',
  'Avg Air Temp (°C)':        'tmean_C',
  'Min Air Temp (°C)':        'tmin_C',
  'Max Air Temp (°C)':        'tmax_C'
};

// AOI overlay
var aoiOutline = ee.Image().byte().paint(AOI, 1, 2);
Map.addLayer(aoiOutline, {palette:['000000']}, 'AOI', true);

// Control panel
var panel = ui.Panel({style: {width: '420px'}});
panel.add(ui.Label('ERA5 Monthly Aggregates — AOI Climate', {
  fontWeight: 'bold', fontSize: '16px'
}));
panel.add(ui.Label('Years: ' + START_YEAR + '–' + END_YEAR + '   |   Climatology: ' + metric.toUpperCase(), {fontSize: '12px'}));

var selVar = ui.Select({
  items: Object.keys(VAR_TO_IC),
  value: 'Total Precipitation (mm)',
  onChange: updateMap
});
var selMonth = ui.Slider({
  min: 1, max: 12, step: 1, value: 1,
  onChange: updateMap,
  style: {stretch: 'horizontal'}
});
panel.add(ui.Panel([ui.Label('Variable:'), selVar], ui.Panel.Layout.flow('horizontal')));
panel.add(ui.Panel([ui.Label('Month:'), selMonth], ui.Panel.Layout.flow('horizontal')));

// Charts containers
panel.add(ui.Label('Monthly Histograms', {fontWeight: 'bold', margin: '12px 0 4px 0'}));
panel.add(chartMonthlyTP);
panel.add(chartMonthlyTmean);
panel.add(chartMonthlyTmin);
panel.add(chartMonthlyTmax);

panel.add(ui.Label('Annual Time Series (with trend lines)', {fontWeight: 'bold', margin: '12px 0 4px 0'}));
panel.add(chartAnnualTP);
panel.add(chartAnnualTmean);
panel.add(chartAnnualTmin);
panel.add(chartAnnualTmax);

ui.root.insert(0, panel);

// Add/update map layer
var currentLayerName = 'Monthly Climatology';
function updateMap() {
  var vLabel = selVar.getValue();
  var m = selMonth.getValue();
  var ic = VAR_TO_IC[vLabel];
  var band = VAR_TO_BAND[vLabel];
  var img = ee.Image(ic.filter(ee.Filter.eq('month', m)).first()).select([band]).clip(AOI);
  Map.layers().reset([
    ui.Map.Layer(aoiOutline, {palette:['000000']}, 'AOI'),
    ui.Map.Layer(img, VIZ[band], currentLayerName + ' — ' + vLabel + ' — ' + MONTH_NAMES[m-1])
  ]);
}
updateMap();  // initialize

// ============================ NOTES =======================================
// - Exports: After running, open the Tasks tab and start the export tasks.
// - Scale: using native ERA5 scale (~27 km). Change 'scale' in Export if needed.
// - Wind components (u10, v10) are loaded & converted; adapt if you want to export/chart them.
// - If your AOI asset is a single Geometry or Feature, the FC cast still works.
// - For very small AOIs, consider increasing scale (e.g., 5000 m) for smooth charts.
