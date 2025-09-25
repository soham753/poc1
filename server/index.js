// server/index.js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Environment detection
const isDevelopment = process.env.NODE_ENV === 'development';

// Store latest data with timestamps
let latestData = {
  temp: null,
  heartrate: null,
  movement: null,
  lat: null,
  lon: null,
};

// Initialize properly - CORRECTED
Object.keys(latestData).forEach(key => {
  latestData[key] = null;
});

// Thresholds for considering data as changed (adjust as needed)
const changeThresholds = {
  temp: 0.1,       // 0.1°C change
  heartrate: 1,    // 1 BPM change
  movement: 0.5,   // 0.5 units change
  lat: 0.0001,     // ~11 meters change
  lon: 0.0001,     // ~11 meters change
};

// Valid movement states
const validMovements = ["sitting", "standing", "walking"];

// Store current command states for IoT devices
let deviceCommands = {
  buzzer: false, // false = off, true = on
  led: false     // false = off, true = on
};

// Validation functions
function isValidNumber(value) {
  return typeof value === 'number' && !isNaN(value) && isFinite(value);
}

function isValidMovement(value) {
  return validMovements.includes(value);
}

function isValidCoordinate(value) {
  return isValidNumber(value) && Math.abs(value) <= 180;
}

// Function to check if data has significantly changed
function hasDataChanged(sensorType, newValue, oldValue) {
  if (oldValue === undefined || oldValue === null) return true;
  if (newValue === undefined || newValue === null) return false;

  // For non-numeric values (like movement states), always consider as changed if different
  if (typeof newValue !== 'number' || typeof oldValue !== 'number') {
    return newValue !== oldValue;
  }

  const threshold = changeThresholds[sensorType];
  return Math.abs(newValue - oldValue) >= threshold;
}

// Function to update only changed fields
function updateChangedFields(newData) {
  const changedFields = {};
  let hasChanges = false;

  Object.keys(newData).forEach(key => {
    if (newData[key] !== undefined && newData[key] !== null) {
      const newValue = newData[key];
      const oldValue = latestData[key]?.value !== undefined ? latestData[key].value : latestData[key];

      if (hasDataChanged(key, newValue, oldValue)) {
        latestData[key] = {
          value: newValue,
          timestamp: new Date().toISOString()
        };
        changedFields[key] = latestData[key];
        hasChanges = true;
      }
    }
  });

  return hasChanges ? changedFields : null;
}

// Validate incoming sensor data
function validateSensorData(data) {
  const errors = [];

  if (data.temp !== undefined && !isValidNumber(data.temp)) {
    errors.push("Temperature must be a valid number");
  }
  
  if (data.heartrate !== undefined && (!isValidNumber(data.heartrate) || data.heartrate < 0)) {
    errors.push("Heart rate must be a valid positive number");
  }
  
  if (data.movement !== undefined && !isValidMovement(data.movement)) {
    errors.push(`Movement must be one of: ${validMovements.join(', ')}`);
  }
  
  if (data.lat !== undefined && !isValidCoordinate(data.lat)) {
    errors.push("Latitude must be a valid coordinate between -180 and 180");
  }
  
  if (data.lon !== undefined && !isValidCoordinate(data.lon)) {
    errors.push("Longitude must be a valid coordinate between -180 and 180");
  }

  return errors;
}

// IoT device can send partial data or full data
app.post("/api/data", (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ 
        message: "Invalid request body",
        timestamp: new Date().toISOString()
      });
    }

    const { temp, heartrate, movement, lat, lon } = req.body;

    // Validate all provided fields
    const validationErrors = validateSensorData({ temp, heartrate, movement, lat, lon });
    if (validationErrors.length > 0) {
      return res.status(400).json({ 
        message: "Validation failed",
        errors: validationErrors,
        timestamp: new Date().toISOString()
      });
    }

    const receivedData = {};
    if (temp !== undefined) receivedData.temp = temp;
    if (heartrate !== undefined) receivedData.heartrate = heartrate;
    if (movement !== undefined) receivedData.movement = movement;
    if (lat !== undefined) receivedData.lat = lat;
    if (lon !== undefined) receivedData.lon = lon;

    if (Object.keys(receivedData).length === 0) {
      return res.status(400).json({ 
        message: "No valid data received",
        timestamp: new Date().toISOString()
      });
    }

    const changedFields = updateChangedFields(receivedData);

    if (changedFields) {
      console.log(`[${new Date().toISOString()}] IoT update:`, changedFields);
      return res.status(200).json({
        message: "Data processed successfully",
        changes: changedFields,
        timestamp: new Date().toISOString()
      });
    } else {
      console.log(`[${new Date().toISOString()}] No significant changes detected`);
      return res.status(200).json({
        message: "Data received but no significant changes detected",
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error("Error processing IoT data:", error);
    return res.status(500).json({ 
      message: "Internal server error",
      timestamp: new Date().toISOString(),
      ...(isDevelopment && { error: error.message })
    });
  }
});

// Frontend requests latest data - only gets changed data since last request
app.post("/api/getData", (req, res) => {
  try {
    const { lastUpdate } = req.body || {};

    // Validate lastUpdate if provided
    if (lastUpdate) {
      const lastUpdateDate = new Date(lastUpdate);
      if (isNaN(lastUpdateDate.getTime())) {
        return res.status(400).json({ 
          message: "Invalid lastUpdate format. Use ISO 8601 format.",
          timestamp: new Date().toISOString()
        });
      }

      const changedSinceLastUpdate = {};
      Object.keys(latestData).forEach(key => {
        if (
          latestData[key] && 
          latestData[key].timestamp &&
          new Date(latestData[key].timestamp) > lastUpdateDate
        ) {
          changedSinceLastUpdate[key] = latestData[key];
        }
      });

      return res.json({
        data: changedSinceLastUpdate,
        fullUpdate: Object.keys(changedSinceLastUpdate).length === 0,
        timestamp: new Date().toISOString()
      });
    } else {
      // Return all data if no lastUpdate provided
      const currentData = {};
      Object.keys(latestData).forEach(key => {
        if (latestData[key] !== null && latestData[key] !== undefined) {
          // Handle both simple values and objects with value/timestamp
          if (latestData[key] && typeof latestData[key] === 'object' && latestData[key].value !== undefined) {
            currentData[key] = latestData[key];
          } else if (latestData[key] !== null) {
            currentData[key] = {
              value: latestData[key],
              timestamp: new Date().toISOString()
            };
          }
        }
      });

      return res.json({
        data: currentData,
        fullUpdate: true,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error("Error in /api/getData:", error);
    return res.status(500).json({ 
      message: "Internal server error",
      timestamp: new Date().toISOString(),
      ...(isDevelopment && { error: error.message })
    });
  }
});

// GET endpoint for simpler frontend requests
app.get("/api/getData", (req, res) => {
  try {
    const currentData = {};
    Object.keys(latestData).forEach(key => {
      if (latestData[key] !== null && latestData[key] !== undefined) {
        // Handle both simple values and objects with value/timestamp
        if (latestData[key] && typeof latestData[key] === 'object' && latestData[key].value !== undefined) {
          currentData[key] = latestData[key];
        } else if (latestData[key] !== null) {
          currentData[key] = {
            value: latestData[key],
            timestamp: new Date().toISOString()
          };
        }
      }
    });

    return res.json({
      data: currentData,
      fullUpdate: true,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error in GET /api/getData:", error);
    return res.status(500).json({ 
      message: "Internal server error",
      timestamp: new Date().toISOString(),
      ...(isDevelopment && { error: error.message })
    });
  }
});

// Endpoint for frontend to get specific fields only
app.post("/api/getSpecificData", (req, res) => {
  try {
    const { fields } = req.body || {};
    
    if (!fields || !Array.isArray(fields)) {
      return res.status(400).json({ 
        message: "Fields array required",
        timestamp: new Date().toISOString()
      });
    }

    // Validate that all requested fields are valid
    const validFields = Object.keys(latestData);
    const invalidFields = fields.filter(field => !validFields.includes(field));
    
    if (invalidFields.length > 0) {
      return res.status(400).json({ 
        message: "Invalid fields requested",
        invalidFields: invalidFields,
        validFields: validFields,
        timestamp: new Date().toISOString()
      });
    }

    const specificData = {};
    fields.forEach(field => {
      if (latestData[field] !== null && latestData[field] !== undefined) {
        // Handle both simple values and objects with value/timestamp
        if (latestData[field] && typeof latestData[field] === 'object' && latestData[field].value !== undefined) {
          specificData[field] = latestData[field];
        } else if (latestData[field] !== null) {
          specificData[field] = {
            value: latestData[field],
            timestamp: new Date().toISOString()
          };
        }
      }
    });

    return res.json({
      data: specificData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error in /api/getSpecificData:", error);
    return res.status(500).json({ 
      message: "Internal server error",
      timestamp: new Date().toISOString(),
      ...(isDevelopment && { error: error.message })
    });
  }
});

// Endpoint to get current thresholds
app.get("/api/thresholds", (req, res) => {
  try {
    res.json({
      thresholds: changeThresholds,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error in /api/thresholds:", error);
    return res.status(500).json({ 
      message: "Internal server error",
      timestamp: new Date().toISOString(),
      ...(isDevelopment && { error: error.message })
    });
  }
});

// Endpoint to update thresholds (admin function)
app.post("/api/thresholds", (req, res) => {
  try {
    const newThresholds = req.body || {};
    
    if (typeof newThresholds !== 'object' || Array.isArray(newThresholds)) {
      return res.status(400).json({ 
        message: "Thresholds must be provided as an object",
        timestamp: new Date().toISOString()
      });
    }

    let updatedCount = 0;
    Object.keys(newThresholds).forEach(key => {
      if (
        changeThresholds[key] !== undefined &&
        isValidNumber(newThresholds[key]) &&
        newThresholds[key] >= 0
      ) {
        changeThresholds[key] = newThresholds[key];
        updatedCount++;
      }
    });

    return res.json({
      message: `Successfully updated ${updatedCount} threshold(s)`,
      thresholds: changeThresholds,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error in /api/thresholds:", error);
    return res.status(500).json({ 
      message: "Internal server error",
      timestamp: new Date().toISOString(),
      ...(isDevelopment && { error: error.message })
    });
  }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    dataFields: Object.keys(latestData),
    serverTime: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// =================== IoT Device Commands ===================

// Endpoint for frontend to set device commands
app.post("/api/deviceCommand", (req, res) => {
  try {
    const { buzzer, led } = req.body || {};

    if (buzzer === undefined && led === undefined) {
      return res.status(400).json({ 
        message: "At least one command (buzzer or led) must be provided",
        timestamp: new Date().toISOString()
      });
    }

    let updated = false;

    if (buzzer !== undefined) {
      if (typeof buzzer !== "boolean") {
        return res.status(400).json({ 
          message: "Buzzer value must be boolean",
          timestamp: new Date().toISOString()
        });
      }
      deviceCommands.buzzer = buzzer;
      updated = true;
    }

    if (led !== undefined) {
      if (typeof led !== "boolean") {
        return res.status(400).json({ 
          message: "LED value must be boolean",
          timestamp: new Date().toISOString()
        });
      }
      deviceCommands.led = led;
      updated = true;
    }

    if (updated) {
      console.log(`[${new Date().toISOString()}] Device commands updated:`, deviceCommands);
    }

    return res.json({
      message: "Device commands updated successfully",
      commands: deviceCommands,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error in /api/deviceCommand:", error);
    return res.status(500).json({ 
      message: "Internal server error",
      timestamp: new Date().toISOString(),
      ...(isDevelopment && { error: error.message })
    });
  }
});

// Endpoint for IoT devices to fetch current commands
app.get("/api/getDeviceCommand", (req, res) => {
  try {
    return res.json({
      commands: deviceCommands,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error in /api/getDeviceCommand:", error);
    return res.status(500).json({ 
      message: "Internal server error",
      timestamp: new Date().toISOString(),
      ...(isDevelopment && { error: error.message })
    });
  }
});

// =================== Error Handling ===================

// 404 handler for undefined routes - CORRECTED
app.use((req, res) => {
  res.status(404).json({
    message: "Endpoint not found",
    timestamp: new Date().toISOString(),
    path: req.path,
    method: req.method
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Unhandled error:", error);
  res.status(500).json({
    message: "Internal server error",
    timestamp: new Date().toISOString(),
    ...(isDevelopment && { 
      error: error.message,
      stack: error.stack 
    })
  });
});

// =================== Graceful shutdown ===================
function gracefulShutdown() {
  console.log("Shutting down server gracefully...");
  process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

const PORT = process.env.PORT || 5000;
app.listen(PORT,"0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log("Available endpoints:");
  console.log("POST /api/data - IoT devices send data (partial or full)");
  console.log("POST /api/getData - Frontend gets latest data (changed since last update)");
  console.log("GET  /api/getData - Frontend gets all current data (simpler)");
  console.log("POST /api/getSpecificData - Frontend gets specific fields only");
  console.log("GET  /api/thresholds - Get current change thresholds");
  console.log("POST /api/thresholds - Update change thresholds");
  console.log("GET  /api/health - Health check");
  console.log("POST /api/deviceCommand - Frontend sets buzzer/LED commands");
  console.log("GET  /api/getDeviceCommand - IoT devices fetch current commands");
});