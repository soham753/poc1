// App.js
import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

const App = () => {
  const [sensorData, setSensorData] = useState({
    temp: { value: null, timestamp: null },
    heartrate: { value: null, timestamp: null },
    movement: { value: null, timestamp: null },
    lat: { value: null, timestamp: null },
    lon: { value: null, timestamp: null },
  });
  const [lastUpdate, setLastUpdate] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [isLoading, setIsLoading] = useState(false);
  const [thresholds, setThresholds] = useState({});
  const [lastRefresh, setLastRefresh] = useState(null);
  const [deviceCommands, setDeviceCommands] = useState({ buzzer: false, led: false });
  const [notifications, setNotifications] = useState([]);

  // Timeout ref to control polling
  const pollingTimeoutRef = useRef(null);
  const POLLING_INTERVAL = 10000; // ✅ 30 seconds

  const API_BASE_URL = 'https://poc1-backend.vercel.app/api';

  // 📢 Notification helper
  const addNotification = useCallback((message, type = 'info') => {
    const id = Date.now();
    const notification = { id, message, type, timestamp: new Date() };
    setNotifications(prev => [notification, ...prev.slice(0, 4)]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  }, []);

  // 🧹 Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
      }
    };
  }, []);

  // 📡 Fetch sensor data
  const fetchData = useCallback(async (isIncremental = false) => {
    try {
      if (!isIncremental) setIsLoading(true);

      const url = `${API_BASE_URL}/getData`;
      const options =
        isIncremental && lastUpdate
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lastUpdate }),
            }
          : {};

      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();

      if (result.data && Object.keys(result.data).length > 0) {
        setSensorData(prev => {
          const newData = { ...prev };
          Object.keys(result.data).forEach(key => {
            if (result.data[key] && result.data[key].value !== undefined) {
              newData[key] = result.data[key];
            }
          });
          return newData;
        });

        if (result.timestamp) {
          setLastUpdate(result.timestamp);
        }

        setConnectionStatus('connected');

        if (isIncremental && result.data) {
          const changedSensors = Object.keys(result.data);
          if (changedSensors.length > 0) {
            addNotification(`${changedSensors.length} sensor(s) updated`, 'success');
          }
        }
      }

      setLastRefresh(new Date());
      return true;
    } catch (error) {
      console.error('Fetch error:', error);
      setConnectionStatus('error');
      addNotification('Failed to fetch data', 'error');
      return false;
    } finally {
      if (!isIncremental) setIsLoading(false);
    }
  }, [lastUpdate, addNotification]);

  // 📊 Fetch thresholds
  const fetchThresholds = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/thresholds`);
      if (response.ok) {
        const result = await response.json();
        setThresholds(result.thresholds || {});
      }
    } catch (error) {
      console.error('Failed to fetch thresholds:', error);
    }
  }, []);

  // 🔧 Fetch device commands
  const fetchDeviceCommands = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/getDeviceCommand`);
      if (response.ok) {
        const result = await response.json();
        setDeviceCommands(result.commands || {});
      }
    } catch (error) {
      console.error('Failed to fetch device commands:', error);
    }
  }, []);

  // 📤 Send command to device
  const sendDeviceCommand = useCallback(
    async (command, value) => {
      try {
        const response = await fetch(`${API_BASE_URL}/deviceCommand`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [command]: value }),
        });

        if (response.ok) {
          const result = await response.json();
          setDeviceCommands(result.commands || {});
          addNotification(`${command.toUpperCase()} ${value ? 'activated' : 'deactivated'}`, 'success');
          return true;
        }
      } catch (error) {
        console.error('Failed to send command:', error);
        addNotification(`Failed to control ${command}`, 'error');
      }
      return false;
    },
    [addNotification]
  );

  // 🩺 Health check
  const checkHealth = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      if (response.ok) {
        const result = await response.json();
        setConnectionStatus(result.status === 'OK' ? 'connected' : 'error');
        return true;
      }
    } catch (error) {
      setConnectionStatus('error');
      return false;
    }
  }, []);

  // 🔄 Controlled polling (runs every 30 sec)
  const startPolling = useCallback(() => {
    if (pollingTimeoutRef.current) clearTimeout(pollingTimeoutRef.current);

    pollingTimeoutRef.current = setTimeout(async function poll() {
      await fetchData(true);
      pollingTimeoutRef.current = setTimeout(poll, POLLING_INTERVAL);
    }, POLLING_INTERVAL);
  }, [fetchData]);

  // 🔁 Manual refresh
  const handleManualRefresh = useCallback(async () => {
    setIsLoading(true);

    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
    }

    await Promise.all([fetchData(false), fetchThresholds(), fetchDeviceCommands(), checkHealth()]);

    startPolling(); // ✅ Restart polling after manual refresh

    setTimeout(() => setIsLoading(false), 300);
    addNotification('Manual refresh completed', 'info');
  }, [fetchData, fetchThresholds, fetchDeviceCommands, checkHealth, addNotification, startPolling]);

  // 🚀 Initialize on mount
  useEffect(() => {
    handleManualRefresh();
    startPolling();
    return () => clearTimeout(pollingTimeoutRef.current);
  }, []);

  // 🕐 Helpers
  const formatTimestamp = timestamp => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    return date.toLocaleTimeString() + ' ' + date.toLocaleDateString();
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return '#10B981';
      case 'error':
        return '#EF4444';
      default:
        return '#F59E0B';
    }
  };

  const getValueColor = (type, value) => {
    if (value === null || value === undefined) return '#6B7280';

    switch (type) {
      case 'temp':
        return value > 38 ? '#EF4444' : value > 37 ? '#F59E0B' : '#10B981';
      case 'heartrate':
        return value > 100 ? '#EF4444' : value > 90 ? '#F59E0B' : '#10B981';
      case 'movement':
        switch (value) {
          case 'sitting':
            return '#10B981';
          case 'standing':
            return '#F59E0B';
          case 'walking':
            return '#EF4444';
          default:
            return '#6B7280';
        }
      default:
        return '#3B82F6';
    }
  };

  const getGoogleMapsUrl = () => {
    if (sensorData.lat?.value && sensorData.lon?.value) {
      return `https://maps.google.com/maps?q=${sensorData.lat.value},${sensorData.lon.value}&z=16&output=embed`;
    }
    return null;
  };

  const getLatestTimestamp = () => {
    const timestamps = Object.values(sensorData)
      .map(data => data?.timestamp)
      .filter(Boolean)
      .sort()
      .reverse();
    return timestamps[0] || null;
  };

  const getDataFreshness = () => {
    const latest = getLatestTimestamp();
    if (!latest) return 'no-data';

    const diff = Date.now() - new Date(latest).getTime();
    if (diff < 10000) return 'very-fresh';
    if (diff < 30000) return 'fresh';
    if (diff < 60000) return 'stale';
    return 'very-stale';
  };

  return (
    <div className="app">
      {/* Notifications */}
      <div className="notifications-container">
        {notifications.map(notification => (
          <div key={notification.id} className={`notification ${notification.type}`}>
            <span>{notification.message}</span>
            <span className="notification-time">{notification.timestamp.toLocaleTimeString()}</span>
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="app-header">
        <div className="header-content">
          <div className="header-main">
            <h1>IoT Sensor Dashboard</h1>
            <div className="status-group">
              <div className="status-indicator" style={{ backgroundColor: getStatusColor() }}>
                {connectionStatus.toUpperCase()}
              </div>
              
            </div>
          </div>

          <div className="header-controls">
            <div className="device-controls">
              <button
                className={`control-btn ${deviceCommands.buzzer ? 'active' : ''}`}
                onClick={() => sendDeviceCommand('buzzer', !deviceCommands.buzzer)}
              >
                Buzzer: {deviceCommands.buzzer ? 'ON' : 'OFF'}
              </button>
              <button
                className={`control-btn ${deviceCommands.led ? 'active' : ''}`}
                onClick={() => sendDeviceCommand('led', !deviceCommands.led)}
              >
                LED: {deviceCommands.led ? 'ON' : 'OFF'}
              </button>
            </div>

            <button
              className={`refresh-btn ${isLoading ? 'loading' : ''}`}
              onClick={handleManualRefresh}
              disabled={isLoading}
            >
              {isLoading ? 'Refreshing...' : 'Refresh Data'}
            </button>
          </div>
        </div>
      </header>

      {/* Dashboard */}
      <main className="dashboard">
        <div className="sensor-grid">
          {/* Temperature Card */}
          <div className="sensor-card temperature-card">
            <div className="card-header">
              <h3>Temperature</h3>
              <span className="unit">°C</span>
            </div>
            <div className="card-content">
              <div className="sensor-value" style={{ color: getValueColor('temp', sensorData.temp?.value) }}>
                {sensorData.temp?.value?.toFixed(1) ?? '--'}
              </div>
              <div className="sensor-details">
              </div>
            </div>
          </div>

          {/* Heart Rate Card */}
          <div className="sensor-card heartrate-card">
            <div className="card-header">
              <h3>Heart Rate</h3>
              <span className="unit">BPM</span>
            </div>
            <div className="card-content">
              <div className="sensor-value" style={{ color: getValueColor('heartrate', sensorData.heartrate?.value) }}>
                {sensorData.heartrate?.value ?? '--'}
              </div>
              <div className="sensor-details">
              </div>
            </div>
          </div>

          {/* Movement Card */}
          <div className="sensor-card movement-card">
            <div className="card-header">
              <h3>Movement</h3>
              <span className="unit">State</span>
            </div>
            <div className="card-content">
              <div
                className="sensor-value movement-value"
                style={{ color: getValueColor('movement', sensorData.movement?.value) }}
              >
                {sensorData.movement?.value ? sensorData.movement.value.toUpperCase() : '--'}
              </div>
              <div className="sensor-details">
              </div>
            </div>
          </div>

          {/* Location Card */}
          <div className="sensor-card location-card full-width">
            <div className="card-header">
              <h3>Location Tracking</h3>
              <span className="unit">GPS</span>
            </div>
            <div className="card-content">
              {getGoogleMapsUrl() ? (
                <div className="map-container">
                  <iframe
                    title="Google Map"
                    src={getGoogleMapsUrl()}
                    className="map-iframe"
                    allowFullScreen
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                  <div className="coordinates">
                    Lat: {sensorData.lat?.value?.toFixed(6) ?? '--'}, Lon: {sensorData.lon?.value?.toFixed(6) ?? '--'}
                  </div>
                </div>
              ) : (
                <div className="no-data">
                  <p>Waiting for GPS signal...</p>
                </div>
              )}
              <div className="sensor-details">
                <div className="threshold">Threshold: ±{thresholds.lat || 0.0001}°</div>
            
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
    
    </div>
  );
};

export default App;
