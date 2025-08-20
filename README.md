## ERA5 Monthly Aggregates — AOI Climate Processor

This Google Earth Engine (GEE) script, **ERA5 Monthly Aggregates — AOI Climate Processor**, processes climate data from the **ECMWF/ERA5/MONTHLY** dataset. It's designed to analyze climate variables within a user-defined Area of Interest (AOI) over a specified period. The script can handle various climate parameters and outputs data as visualizations, charts, and downloadable raster files.

### 📝 Project Description

The primary purpose of this script is to facilitate advanced climate analysis using monthly aggregated ERA5 data. It automates several key tasks:

  * **Data Ingestion and Processing**: Loads ERA5 monthly data and performs essential unit conversions. Specifically, it converts total precipitation from meters to millimeters and temperatures (mean, minimum, and maximum) from Kelvin to Celsius.
  * **Climatology Generation**: Computes monthly climatologies (mean or median values across all years) for key variables. This generates 12 distinct images, one for each calendar month, representing the long-term monthly average or median conditions.
  * **Time Series Analysis**: Creates annual time series data for precipitation and temperatures. It calculates the annual total precipitation and the annual average for each temperature variable within the specified AOI.
  * **Data Visualization**: Generates interactive charts and a map-based user interface (UI) to visualize the results. The UI allows users to browse monthly climatologies on the map. Charts include:
      * **Monthly Bar Charts**: Histograms of monthly climatological values for precipitation and temperatures.
      * **Annual Line Charts**: Time series plots showing the year-to-year variation of annual totals/means, including a linear trendline and R² value to indicate long-term changes.
  * **Data Export**: Provides functionality to export monthly climatology raster images to a specified Google Drive folder. This is useful for further analysis in Geographic Information System (GIS) software or other tools.

The script is highly customizable through a **USER PARAMETERS** section at the beginning, where users can define their AOI, analysis years, and the averaging metric for climatologies.
