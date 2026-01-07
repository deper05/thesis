/**
 * MOBILE-OPTIMIZED admin-dashboard.js with Combined Report Feature, Edit Coordinates,
 * and NEW Informative Toast Notifications.
 * * MOBILE FIXES APPLIED:
 * 1. Added mobile-optimized authentication with anti-loop protection
 * 2. Added authProcessing flag to prevent simultaneous auth state changes
 * 3. Increased timeouts for mobile stability
 * 4. Better session handling for mobile browsers
 * 5. Fixed redirect timing issues
 * 
 * * SUPER ADMIN UPDATES APPLIED:
 * 1. Added Super Admin status checking
 * 2. Added Super Admin UI toggling
 * 3. Added admin management functions (add/remove admins)
 * 4. Enhanced security for admin management
 */

// ============================================================================
// FIREBASE INITIALIZATION (MISSING IN ORIGINAL CODE)
// ============================================================================

// Firebase should be initialized in admin.html or dashboard.html
// If not, add this at the beginning:
/*
if (typeof firebase === 'undefined') {
    console.error('Firebase is not loaded. Make sure firebase scripts are included.');
}
*/
// Make sure Firebase is properly initialized
if (typeof firebase === 'undefined') {
    console.error('Firebase is not loaded!');
} else {
    console.log('Firebase loaded successfully');
}

// Check if database is available
if (typeof database === 'undefined') {
    console.error('Firebase database is not initialized!');
    // Try to initialize it
    try {
        const app = firebase.initializeApp(firebaseConfig);
        const database = firebase.database();
        const auth = firebase.auth();
        console.log('Firebase re-initialized');
    } catch (error) {
        console.error('Failed to initialize Firebase:', error);
    }
}

async function testDatabaseConnection() {
    try {
        console.log('Testing database connection...');
        // Only test the connection status, don't try to read protected data yet
        const testRef = database.ref('.info/connected');
        testRef.on('value', (snap) => {
            console.log('Database connection status:', snap.val());
        });
        
        // Don't test adminUsers access here - wait until after authentication
        console.log('Database connection test completed');
        return true;
    } catch (error) {
        console.error('Database connection test failed:', error);
        return false;
    }
}

// Call this function early in your code
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM loaded, testing database...');
    const connected = await testDatabaseConnection();
    if (!connected) {
        showToast('Database connection failed. Please refresh the page.', 'danger');
    }
    // Rest of your existing code...
});

// Make sure these are defined globally or imported
if (typeof auth === 'undefined') {
    console.warn('Firebase auth is not defined. Make sure firebase.auth() is initialized.');
}

if (typeof database === 'undefined') {
    console.warn('Firebase database is not defined. Make sure firebase.database() is initialized.');
}

/**
 * Thresholds for determining "bad" water quality readings
 * @constant {Object}
 */
const BAD_READING_THRESHOLDS = {
    'pH': { min: 6.5, max: 8.5 },
    'temperature': { min: 10, max: 30 }, // Celsius
    'turbidity': { max: 25 }, // NTU
    'tds': { max: 500 } // mg/L or ppm
};

/**
 * Invalid characters for Firebase keys
 * @constant {RegExp}
 */
const INVALID_FIREBASE_CHARS = /[.#$/\[\]]/;

/**
 * Minimum password length for user creation
 * @constant {number}
 */
const MIN_PASSWORD_LENGTH = 6;

// ============================================================================
// DATA FLOW MONITORING CONFIGURATION
// ============================================================================

/**
 * Configuration for data flow monitoring
 * @constant {Object}
 */
const DATA_FLOW_CONFIG = {
    CHECK_INTERVAL: 300000, // Check every 5 minutes (300000ms)
    STALE_DATA_THRESHOLD: 1800000, // Alert if no data for 30 minutes (1800000ms)
    ALERT_CONTAINER_ID: 'data-flow-alerts'
};

// Track last data timestamps for each unit
const unitLastDataTimestamp = {};

// Track data flow monitoring interval
let dataFlowIntervalId = null;

// ============================================================================
// *** NEW *** - SPREADSHEET DOWNLOAD FUNCTIONS
// ============================================================================

/**
 * Converts data to CSV format and triggers download
 * @param {Array} data - Array of data objects
 * @param {string} filename - Name for the downloaded file
 */
function downloadAsCSV(data, filename) {
    if (!data || data.length === 0) {
        showToast('No data available to download', 'warning');
        return;
    }

    try {
        // Get headers from first object
        const headers = Object.keys(data[0]);
        
        // Create CSV content
        let csvContent = headers.join(',') + '\n';
        
        data.forEach(row => {
            const values = headers.map(header => {
                let value = row[header] || '';
                // Handle values that might contain commas or quotes
                if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                    value = `"${value.replace(/"/g, '""')}"`;
                }
                return value;
            });
            csvContent += values.join(',') + '\n';
        });

        // Create and trigger download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Clean up
        setTimeout(() => URL.revokeObjectURL(url), 100);
        
        showToast(`Downloaded: ${filename}`, 'success');
        
    } catch (error) {
        console.error('Error generating CSV:', error);
        showToast('Error generating download file', 'danger');
    }
}

/**
 * Downloads single unit report as CSV
 * @param {string} unitId - Unit ID
 * @param {string} unitName - Unit name
 * @param {string} selectedDate - Selected date
 * @param {Array} readingsForDay - Array of reading objects
 */
function downloadSingleUnitReport(unitId, unitName, selectedDate, readingsForDay) {
    if (!readingsForDay || readingsForDay.length === 0) {
        showToast('No data available to download', 'warning');
        return;
    }

    const metricSuffix = unitId.split('_').pop();
    const dataForCSV = [];

    readingsForDay.forEach(reading => {
        const data = reading.data;
        
        // Extract values with fallback for different data structures
        const phValue = data[`ph_${metricSuffix}`] !== undefined ? data[`ph_${metricSuffix}`] : data.ph;
        const tempValue = data[`temperature_${metricSuffix}`] !== undefined ? data[`temperature_${metricSuffix}`] : data.temperature;
        const turbidityValue = data[`turbidity_${metricSuffix}`] !== undefined ? data[`turbidity_${metricSuffix}`] : data.turbidity;
        const tdsValue = data[`tds_${metricSuffix}`] !== undefined ? data[`tds_${metricSuffix}`] : data.tds;

        dataForCSV.push({
            Timestamp: reading.timestamp,
            Unit: unitName,
            'pH Level': phValue !== undefined && phValue !== null ? parseFloat(phValue).toFixed(2) : 'N/A',
            'Temperature (°C)': tempValue !== undefined && tempValue !== null ? parseFloat(tempValue).toFixed(2) : 'N/A',
            'Turbidity (NTU)': turbidityValue !== undefined && turbidityValue !== null ? parseFloat(turbidityValue).toFixed(2) : 'N/A',
            'TDS (ppm)': tdsValue !== undefined && tdsValue !== null ? parseFloat(tdsValue).toFixed(2) : 'N/A'
        });
    });

    const filename = `water_quality_${unitName}_${selectedDate}.csv`.replace(/ /g, '_');
    downloadAsCSV(dataForCSV, filename);
}

/**
 * Downloads combined report as CSV
 * @param {Array} allData - Combined data from all units
 * @param {string} selectedDate - Selected date
 * @param {Object} unitNames - Object mapping unit IDs to names
 */
function downloadCombinedReport(allData, selectedDate, unitNames) {
    if (!allData || allData.length === 0) {
        showToast('No data available to download', 'warning');
        return;
    }

    const dataForCSV = allData.map(row => ({
        Timestamp: row.timestamp,
        Unit: unitNames[row.unit] || row.unit,
        'pH Level': row.ph !== 'N/A' ? parseFloat(row.ph).toFixed(2) : 'N/A',
        'Temperature (°C)': row.temp !== 'N/A' ? parseFloat(row.temp).toFixed(2) : 'N/A',
        'Turbidity (NTU)': row.turbidity !== 'N/A' ? parseFloat(row.turbidity).toFixed(2) : 'N/A',
        'TDS (ppm)': row.tds !== 'N/A' ? parseFloat(row.tds).toFixed(2) : 'N/A'
    }));

    const dateSuffix = selectedDate || 'all_time';
    const filename = `combined_water_quality_report_${dateSuffix}.csv`.replace(/ /g, '_');
    downloadAsCSV(dataForCSV, filename);
}

// ============================================================================
// MOBILE AUTHENTICATION - ANTI-LOOP PROTECTION
// ============================================================================

let authProcessing = false; // Global flag to prevent simultaneous auth processing

/**
 * Checks if user is admin by checking the adminUsers database node
 * This works on Firebase Free plan (no custom claims needed)
 */
async function checkAdminStatus(user) {
    try {
        console.log('🔍 Checking admin status for:', user.email);
        
        // Check database for admin status
        const adminUserSnapshot = await database.ref(`adminUsers/${user.uid}`).once('value');
        const isAdmin = adminUserSnapshot.exists() && adminUserSnapshot.val().isAdmin === true;
        
        console.log('📊 Database admin check result:', isAdmin);
        
        return isAdmin;
    } catch (error) {
        console.error('❌ Error checking admin status:', error);
        return false;
    }
}

// ============================================================================
// SUPER ADMIN FUNCTIONS
// ============================================================================

/**
 * Checks if user is a Super Admin
 * @param {Object} user - Firebase user object
 * @returns {Promise<boolean>} True if user is Super Admin
 */
async function checkSuperAdminStatus(user) {
    try {
        console.log('🔍 Checking Super Admin status for:', user.email);
        
        const adminUserSnapshot = await database.ref(`adminUsers/${user.uid}`).once('value');
        const adminData = adminUserSnapshot.exists() ? adminUserSnapshot.val() : null;
        
        const isSuperAdmin = adminData && adminData.isSuperAdmin === true;
        
        console.log('👑 Super Admin check result:', isSuperAdmin);
        return isSuperAdmin;
    } catch (error) {
        console.error('❌ Error checking Super Admin status:', error);
        return false;
    }
}

/**
 * Toggles the visibility of Super Admin management UI
 * @param {boolean} isSuperAdmin - Whether user is Super Admin
 */
function toggleSuperAdminUI(isSuperAdmin) {
    // Show/Hide Super Admin tab in navbar
    const superAdminTab = document.getElementById('nav-manage-admins-container');
    if (superAdminTab) {
        superAdminTab.style.display = isSuperAdmin ? 'block' : 'none';
    }
    
    // Show/Hide Super Admin section
    const superAdminSection = document.getElementById('super-admin-section');
    if (superAdminSection) {
        superAdminSection.style.display = isSuperAdmin ? 'block' : 'none';
    }
}

/**
 * Loads all administrators for Super Admin management
 */
async function loadAllAdmins() {
    const adminsList = document.getElementById('admins-list');
    if (!adminsList) return;
    
    adminsList.innerHTML = `
        <tr>
            <td colspan="5" class="text-center text-muted">
                <div class="spinner-border spinner-border-sm me-2" role="status"></div>
                Loading administrators...
            </td>
        </tr>
    `;
    
    try {
        const snapshot = await database.ref('adminUsers').once('value');
        
        if (!snapshot.exists()) {
            adminsList.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center text-muted">
                        No administrators found.
                    </td>
                </tr>
            `;
            return;
        }
        
        const currentUser = auth.currentUser;
        let html = '';
        
        snapshot.forEach((childSnapshot) => {
            const uid = childSnapshot.key;
            const adminData = childSnapshot.val();
            
            // Don't show the current user in the delete list
            const isCurrentUser = currentUser && uid === currentUser.uid;
            
            html += `
                <tr class="admin-row">
                    <td>
                        ${adminData.email || 'No email'}
                        ${isCurrentUser ? '<span class="badge bg-info ms-2">You</span>' : ''}
                    </td>
                    <td>
                        ${adminData.isSuperAdmin ? 
                            '<span class="badge badge-superadmin role-badge"><i class="fas fa-crown me-1"></i>Super Admin</span>' : 
                            '<span class="badge badge-admin role-badge"><i class="fas fa-user-gear me-1"></i>Admin</span>'
                        }
                    </td>
                    <td>
                        ${adminData.createdAt ? 
                            new Date(adminData.createdAt).toLocaleDateString() : 
                            'Unknown'
                        }
                    </td>
                    <td>
                        ${adminData.addedBy || 'System'}
                    </td>
                    <td class="admin-actions">
                        ${!isCurrentUser ? `
                            <button class="btn btn-sm btn-danger remove-admin-btn" 
                                    data-uid="${uid}" 
                                    data-email="${adminData.email || ''}">
                                <i class="fas fa-trash"></i> Remove
                            </button>
                        ` : `
                            <span class="text-muted">Cannot remove yourself</span>
                        `}
                    </td>
                </tr>
            `;
        });

        async function loadAllAdmins() {
    // First check if current user is Super Admin
    const user = auth.currentUser;
    if (!user) {
        showToast('You must be logged in to view administrators', 'danger');
        return;
    }
    
    const isSuperAdmin = await checkSuperAdminStatus(user);
    if (!isSuperAdmin) {
        const adminsList = document.getElementById('admins-list');
        if (adminsList) {
            adminsList.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center text-warning">
                        <i class="fas fa-shield-alt me-2"></i>
                        Only Super Administrators can view this page.
                    </td>
                </tr>
            `;
        }
        return;
    }
    
    // Rest of your existing loadAllAdmins() code...
}
        
        adminsList.innerHTML = html;
        
        // Attach event listeners to remove buttons
        document.querySelectorAll('.remove-admin-btn').forEach(button => {
            button.addEventListener('click', function() {
                const uid = this.getAttribute('data-uid');
                const email = this.getAttribute('data-email');
                showDeleteAdminModal(uid, email);
            });
        });
        
    } catch (error) {
        console.error('❌ Error loading admins:', error);
        
        // More specific error handling
        let errorMessage = 'Unknown error';
        if (error.code === 'PERMISSION_DENIED') {
            errorMessage = 'Permission denied. You may not have Super Admin privileges to view all administrators.';
        } else {
            errorMessage = error.message;
        }
        
        adminsList.innerHTML = `
            <tr>
                <td colspan="5" class="text-center text-danger">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    ${errorMessage}
                </td>
            </tr>
        `;
        
        // Show a toast notification
        showToast('Unable to load admin list: ' + errorMessage, 'danger');
    }
}

/**
 * Shows confirmation modal for deleting an admin
 */
function showDeleteAdminModal(uid, email) {
    const infoDiv = document.getElementById('admin-to-delete-info');
    if (infoDiv) {
        infoDiv.innerHTML = `
            <div class="alert alert-light border">
                <strong>Email:</strong> ${email}<br>
                <strong>User ID:</strong> ${uid}
            </div>
        `;
    }
    
    // Store the admin to delete in a global variable
    window.adminToDelete = { uid, email };
    
    const modal = new bootstrap.Modal(document.getElementById('deleteAdminModal'));
    modal.show();
}

/**
 * Removes an administrator from the system
 */
async function removeAdministrator(uid) {
    try {
        // Check if current user is Super Admin
        const user = auth.currentUser;
        const isSuperAdmin = await checkSuperAdminStatus(user);
        
        if (!isSuperAdmin) {
            showToast('Only Super Admins can remove administrators', 'danger');
            return;
        }
        
        // Don't allow removing yourself
        if (uid === user.uid) {
            showToast('You cannot remove yourself', 'warning');
            return;
        }
        
        // Remove from adminUsers node
        await database.ref(`adminUsers/${uid}`).remove();
        
        // Success message
        showToast('Administrator removed successfully!', 'success');
        
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('deleteAdminModal'));
        if (modal) modal.hide();
        
        // Refresh admin list
        loadAllAdmins();
        
    } catch (error) {
        console.error('❌ Error removing admin:', error);
        showToast(`Failed to remove administrator: ${error.message}`, 'danger');
    }
}

/**
 * Enhanced add user function with Super Admin check
 */
async function addUserAsSuperAdmin(email, password, isSuperAdmin = false) {
    const currentUser = auth.currentUser;
    
    // Check if current user is Super Admin
    const currentUserIsSuperAdmin = await checkSuperAdminStatus(currentUser);
    if (!currentUserIsSuperAdmin) {
        showToast('Only Super Admins can add new administrators', 'danger');
        return false;
    }
    
    let secondaryApp = null;
    try {
        // Use secondary app to create user (same as existing logic)
        const secondaryConfig = {
            apiKey: "AIzaSyDQL-6PMlYVED2I2KpYISiDaf4huUg9tZw",
            authDomain: "thesis-1bda3.firebaseapp.com",
            databaseURL: "https://thesis-1bda3-default-rtdb.asia-southeast1.firebasedatabase.app",
            projectId: "thesis-1bda3",
            storageBucket: "thesis-1bda3.firebasestorage.app",
            messagingSenderId: "509024706594",
            appId: "1:509024706594:web:4823234418f6a1d9b66a7b"
        };
        
        secondaryApp = firebase.initializeApp(secondaryConfig, "SuperAdminAddUser_" + Date.now());
        const secondaryAuth = secondaryApp.auth();
        
        // Create user
        const userCredential = await secondaryAuth.createUserWithEmailAndPassword(email, password);
        const newUserUid = userCredential.user.uid;
        
        // Write to database with appropriate privileges
        const adminUserRef = database.ref(`adminUsers/${newUserUid}`);
        await adminUserRef.set({
            email: email,
            createdAt: new Date().toISOString(),
            addedBy: currentUser.email,
            isAdmin: true,
            isSuperAdmin: isSuperAdmin
        });
        
        // Clean up
        await secondaryAuth.signOut();
        return true;
        
    } catch (error) {
        console.error('❌ Error creating admin user:', error);
        throw error;
    } finally {
        // Always clean up the secondary app
        if (secondaryApp) {
            try {
                await secondaryApp.delete();
            } catch (deleteError) {
                console.warn('Failed to delete secondary app:', deleteError);
            }
        }
    }
}

// ============================================================================
// *** MODIFIED *** - NEW COMBINED REPORT FUNCTION
// ============================================================================

async function generateCombinedReport(selectedDate) {
    const unitIds = ["unit_1", "unit_2"];
    const allData = [];
    const unitNames = {}; // Store unit names from metadata

    // Fetch unit names from metadata
    for (const unitId of unitIds) {
        try {
            const metadataSnapshot = await database.ref(`unitsMetadata/${unitId}`).once("value");
            if (metadataSnapshot.exists()) {
                unitNames[unitId] = metadataSnapshot.val().name || unitId;
            } else {
                unitNames[unitId] = unitId;
            }
        } catch (error) {
            console.error(`Error fetching metadata for ${unitId}:`, error);
            unitNames[unitId] = unitId;
        }
    }

    // Fetch data for both units
    for (const unitId of unitIds) {
        // FIXED: Use database.ref() instead of firebase.database().ref()
        const snapshot = await database.ref(unitId).once("value");
        const data = snapshot.val();

        if (data) {
            Object.keys(data).forEach(timestamp => {
                // Skip the initialization placeholders
                if (timestamp === 'initialized' || timestamp === 'timestamp') {
                    return;
                }
                
                // Filter by selected date if provided
                if (selectedDate && !timestamp.startsWith(selectedDate)) {
                    return;
                }
                
                const reading = data[timestamp];
                // Extract the suffix number (1 or 2) from unitId
                const suffix = unitId.split('_').pop();
                
                allData.push({
                    unit: unitId,
                    timestamp: timestamp,
                    ph: reading[`ph_${suffix}`] || 'N/A',
                    temp: reading[`temperature_${suffix}`] || 'N/A',
                    tds: reading[`tds_${suffix}`] || 'N/A',
                    turbidity: reading[`turbidity_${suffix}`] || 'N/A'
                });
            });
        }
    }

    // ---------------------------
    // CHECK IF DATA EXISTS
    // ---------------------------
    if (allData.length === 0) {
        document.getElementById("combined-table-content").innerHTML =
            `<p class="text-center text-muted">No data found for Unit 1 and Unit 2.</p>`;
        document.getElementById("combined-report-table").style.display = "block";
        showToast(`No combined data found for ${selectedDate}`, 'warning'); // ADDED NOTIFICATION
        return;
    }

    // ---------------------------
    // CALCULATE METRICS FOR EACH UNIT
    // ---------------------------
    const unitMetrics = {};
    
    unitIds.forEach(unitId => {
        const unitData = allData.filter(row => row.unit === unitId);
        
        const metrics = {
            'pH': [],
            'temperature': [],
            'turbidity': [],
            'tds': []
        };
        
        unitData.forEach(row => {
            if (row.ph !== 'N/A' && !isNaN(parseFloat(row.ph))) {
                metrics['pH'].push(parseFloat(row.ph));
            }
            if (row.temp !== 'N/A' && !isNaN(parseFloat(row.temp))) {
                metrics['temperature'].push(parseFloat(row.temp));
            }
            if (row.turbidity !== 'N/A' && !isNaN(parseFloat(row.turbidity))) {
                metrics['turbidity'].push(parseFloat(row.turbidity));
            }
            if (row.tds !== 'N/A' && !isNaN(parseFloat(row.tds))) {
                metrics['tds'].push(parseFloat(row.tds));
            }
        });
        
        // Calculate stats for each metric
        unitMetrics[unitId] = {};
        for (const metricName in metrics) {
            const values = metrics[metricName];
            
            if (values.length > 0) {
                const sum = values.reduce((a, b) => a + b, 0);
                const avg = sum / values.length;
                const min = Math.min(...values);
                const max = Math.max(...values);
                const count = values.length;
                
                unitMetrics[unitId][metricName] = { avg, min, max, count };
            } else {
                unitMetrics[unitId][metricName] = { 
                    avg: 'N/A', 
                    min: 'N/A', 
                    max: 'N/A', 
                    count: 0 
                };
            }
        }
    });

    // ---------------------------
    // GENERATE HTML TABLES
    // ---------------------------
    
    // Add header with date and download button
    let tableHTML = `
        <div class="text-center mb-3">
            <h5 class="text-primary">📅 Report Date: ${selectedDate || 'All Time'}</h5>
            <button class="btn btn-success btn-sm mt-2" id="download-combined-report">
                <i class="fas fa-download me-1"></i> Download Combined Report (CSV)
            </button>
        </div>
        <div class="row">
    `;
    
    unitIds.forEach(unitId => {
        const unitName = unitNames[unitId] || unitId;
        
        tableHTML += `
            <div class="col-md-6 mb-3">
                <h5 class="text-center">${unitName}</h5>
                <div class="table-responsive">
                    <table class="table table-striped table-bordered">
                        <thead class="table-dark">
                            <tr>
                                <th>Metric</th>
                                <th>Average</th>
                                <th>Min</th>
                                <th>Max</th>
                                <th>Count</th>
                            </tr>
                        </thead>
                        <tbody>
        `;
        
        const metricsOrder = ['pH', 'temperature', 'turbidity', 'tds'];
        metricsOrder.forEach(metricName => {
            const stats = unitMetrics[unitId][metricName];
            const avg = typeof stats.avg === 'number' ? stats.avg.toFixed(2) : stats.avg;
            const min = typeof stats.min === 'number' ? stats.min.toFixed(2) : stats.min;
            const max = typeof stats.max === 'number' ? stats.max.toFixed(2) : stats.max;
            
            tableHTML += `
                <tr>
                    <td><strong>${metricName}</strong></td>
                    <td>${avg}</td>
                    <td>${min}</td>
                    <td>${max}</td>
                    <td>${stats.count}</td>
                </tr>
            `;
        });
        
        tableHTML += `
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    });
    
    tableHTML += '</div>';

    // Insert tables
    document.getElementById("combined-table-content").innerHTML = tableHTML;

    // Add download button event listener
    setTimeout(() => {
        const downloadBtn = document.getElementById('download-combined-report');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                downloadCombinedReport(allData, selectedDate, unitNames);
            });
        }
    }, 100);

    // Show the card
    document.getElementById("combined-report-table").style.display = "block";
    
    // Auto-scroll to the combined report table
    setTimeout(() => {
        const combinedTable = document.getElementById("combined-report-table");
        if (combinedTable) {
            combinedTable.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'start' 
            });
        }
    }, 100);
    
    // Show success message
    showAlert('report-alerts', 'success', 
        `✅ Combined report generated successfully with ${allData.length} total readings!`);
    
    showToast(`Combined report generated! (${allData.length} readings)`, 'success'); // ADDED NOTIFICATION
}

// ============================================================================
// UTILITY HELPER FUNCTIONS & TOAST SYSTEM
// ============================================================================

/**
 * Injects styles for the toast notification system
 */
function injectToastStyles() {
    if (document.getElementById('toast-style')) return;
    
    const style = document.createElement('style');
    style.id = 'toast-style';
    style.innerHTML = `
        #toast-notification-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: none;
        }
        .custom-toast {
            min-width: 300px;
            max-width: 400px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            padding: 15px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            animation: slideIn 0.3s ease-out forwards;
            pointer-events: auto;
            border-left: 5px solid #0d6efd;
            }
        .custom-toast.success { border-left-color: #198754; }
        .custom-toast.danger { border-left-color: #dc3545; }
        .custom-toast.warning { border-left-color: #ffc107; }
        .custom-toast.info { border-left-color: #0dcaf0; }
        
        .toast-content { margin-right: 10px; }
        .toast-title { font-weight: bold; font-size: 0.9rem; margin-bottom: 2px; }
        .toast-msg { font-size: 0.85rem; color: #666; }
        
        .toast-close {
            background: none;
            border: none;
            font-size: 1.2rem;
            color: #999;
            cursor: pointer;
            padding: 0;
            line-height: 1;
        }
        .toast-close:hover { color: #333; }
        
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
    `;
    document.head.appendChild(style);
    
    // Create container
    const container = document.createElement('div');
    container.id = 'toast-notification-container';
    document.body.appendChild(container);
}

/**
 * Displays a floating toast notification
 * @param {string} message - The message to display
 * @param {string} type - 'success', 'danger', 'warning', 'info'
 * @param {number} duration - Duration in ms (default 4000)
 */
function showToast(message, type = 'info', duration = 4000) {
    // Ensure styles exist
    injectToastStyles();
    
    const container = document.getElementById('toast-notification-container');
    if (!container) return;
    
    const icons = {
        success: '✅',
        danger: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    const titles = {
        success: 'Success',
        danger: 'Error',
        warning: 'Warning',
        info: 'Information'
    };
    
    const toast = document.createElement('div');
    toast.className = `custom-toast ${type}`;
    toast.innerHTML = `
        <div class="toast-content">
            <div class="toast-title">${icons[type] || ''} ${titles[type]}</div>
            <div class="toast-msg">${message}</div>
        </div>
        <button class="toast-close">&times;</button>
    `;
    
    // Close button handler
    toast.querySelector('.toast-close').addEventListener('click', () => {
        toast.style.animation = 'slideOut 0.3s ease-in forwards';
        setTimeout(() => toast.remove(), 300);
    });
    
    container.appendChild(toast);
    
    // Auto dismiss
    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.animation = 'slideOut 0.3s ease-in forwards';
            setTimeout(() => toast.remove(), 300);
        }
    }, duration);
}

/**
 * Shows a Bootstrap alert message in a specified container
 * @param {string} containerId - ID of the container element
 * @param {string} type - Alert type (success, danger, warning, info)
 * @param {string} message - Message to display
 * @param {boolean} dismissible - Whether alert can be dismissed (default: true)
 */
function showAlert(containerId, type, message, dismissible = true) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`Alert container '${containerId}' not found`);
        return;
    }
    
    const dismissibleClass = dismissible ? 'alert-dismissible fade show' : '';
    const closeButton = dismissible ? '<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>' : '';
    
    const alertHTML = `
        <div class="alert alert-${type} ${dismissibleClass}" role="alert">
            ${message}
            ${closeButton}
        </div>
    `;
    
    container.innerHTML = alertHTML;
}

/**
 * Shows a Bootstrap modal with custom title and message
 * @param {string} title - Modal title
 * @param {string} message - Modal body message
 * @param {Function} onConfirm - Callback function when confirmed (optional)
 * @param {boolean} isConfirmDialog - Whether this is a confirm dialog (default: false)
 */
function showModal(title, message, onConfirm = null, isConfirmDialog = false) {
    // Create modal element if it doesn't exist
    let modal = document.getElementById('utilityModal');
    
    if (!modal) {
        const modalHTML = `
            <div class="modal fade" id="utilityModal" tabindex="-1" aria-labelledby="utilityModalLabel" aria-hidden="true">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="utilityModalLabel"></h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body" id="utilityModalBody"></div>
                        <div class="modal-footer" id="utilityModalFooter">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        modal = document.getElementById('utilityModal');
    }
    
    // Update modal content
    document.getElementById('utilityModalLabel').textContent = title;
    document.getElementById('utilityModalBody').innerHTML = message;
    
    // Configure footer based on dialog type
    const footer = document.getElementById('utilityModalFooter');
    if (isConfirmDialog && onConfirm) {
        footer.innerHTML = `
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-danger" id="utilityModalConfirm">Confirm</button>
        `;
        
        // Add confirm handler
        const confirmBtn = document.getElementById('utilityModalConfirm');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', function() {
                onConfirm();
                const modalInstance = bootstrap.Modal.getInstance(modal);
                if (modalInstance) modalInstance.hide();
            });
        }
    } else {
        footer.innerHTML = '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>';
    }
    
    // Show modal
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
}

/**
 * Shows a loading spinner in a target element
 * @param {string} targetId - ID of the target element
 * @param {string} message - Loading message (default: 'Loading...')
 */
function showLoading(targetId, message = 'Loading...') {
    const target = document.getElementById(targetId);
    if (!target) {
        console.error(`Loading target '${targetId}' not found`);
        return;
    }
    
    target.innerHTML = `
        <div class="text-center py-4">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">${message}</span>
            </div>
            <p class="mt-2 text-muted">${message}</p>
        </div>
    `;
}

/**
 * Hides loading spinner and clears content in target element
 * @param {string} targetId - ID of the target element
 */
function hideLoading(targetId) {
    const target = document.getElementById(targetId);
    if (target) {
        target.innerHTML = '';
    }
}

/**
 * Validates a unit ID for Firebase compatibility
 * @param {string} unitId - Unit ID to validate
 * @returns {Object} {valid: boolean, error: string}
 */
function validateUnitId(unitId) {
    if (!unitId || !unitId.trim()) {
        return { valid: false, error: 'Unit ID is required.' };
    }
    
    if (INVALID_FIREBASE_CHARS.test(unitId)) {
        return { valid: false, error: 'Unit ID cannot contain ".", "#", "$", "/", "[", or "]".' };
    }
    
    return { valid: true, error: null };
}

/**
 * Validates an email address format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid email format
 */
function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Validates password meets minimum requirements
 * @param {string} password - Password to validate
 * @returns {Object} {valid: boolean, error: string}
 */
function validatePassword(password) {
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
        return { 
            valid: false, 
            error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.` 
        };
    }
    return { valid: true, error: null };
}

// ============================================================================
// DATA FLOW MONITORING FUNCTIONS
// ============================================================================

/**
 * Creates or gets the data flow alerts container
 * @returns {HTMLElement} The alerts container element
 */
function getDataFlowAlertsContainer() {
    let container = document.getElementById(DATA_FLOW_CONFIG.ALERT_CONTAINER_ID);
    
    if (!container) {
        // Create container after the navbar, before admin-content
        const navbar = document.querySelector('.navbar');
        container = document.createElement('div');
        container.id = DATA_FLOW_CONFIG.ALERT_CONTAINER_ID;
        container.className = 'container-fluid mt-3';
        navbar.parentNode.insertBefore(container, navbar.nextSibling);
    }
    
    return container;
}

/**
 * Shows data flow alert for units with stale data
 * @param {Array} staleUnits - Array of unit objects with stale data
 */
function showDataFlowAlert(staleUnits) {
    const container = getDataFlowAlertsContainer();
    
    if (staleUnits.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    const unitsList = staleUnits.map(unit => 
        `<li><strong>${unit.name}</strong> (ID: ${unit.id}) - Last data: ${unit.timeSinceLastData}</li>`
    ).join('');
    
    // Also show a toast for stale data if not already shown recently
    showToast(`⚠️ Alert: ${staleUnits.length} unit(s) have not sent data recently. Check dashboard.`, 'warning', 6000);
    
    const alertHtml = `
        <div class="alert alert-warning alert-dismissible fade show" role="alert">
            <div class="d-flex align-items-start">
                <div class="flex-shrink-0 me-3">
                    <span style="font-size: 2rem;">⚠️</span>
                </div>
                <div class="flex-grow-1">
                    <h5 class="alert-heading mb-2">⚠️ No New Data Detected</h5>
                    <p class="mb-2">The following monitoring unit(s) have not sent data recently:</p>
                    <ul class="mb-2">
                        ${unitsList}
                    </ul>
                    <hr>
                    <p class="mb-0">
                        <strong>Possible causes:</strong>
                        <br>• Internet connection issues at the monitoring site
                        <br>• Low battery or power supply problems
                        <br>• Hardware malfunction
                        <br><em>Please check the prototype's connection and power status.</em>
                    </p>
                </div>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
    `;
    
    container.innerHTML = alertHtml;
}

/**
 * Formats milliseconds into human-readable time
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted time string
 */
function formatTimeSince(ms) {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'Just now';
}

/**
 * Checks all units for recent data and alerts if data is stale
 * @async
 */
async function checkDataFlow() {
    try {
        const metadataSnapshot = await database.ref('unitsMetadata').once('value');
        
        if (!metadataSnapshot.exists()) {
            console.log('No units found for data flow monitoring');
            return;
        }
        
        const currentTime = Date.now();
        const staleUnits = [];
        
        // Check each unit
        const checkPromises = [];
        
        metadataSnapshot.forEach(unitSnapshot => {
            const unitId = unitSnapshot.key;
            const unitData = unitSnapshot.val();
            
            const checkPromise = (async () => {
                try {
                    // Get the latest data point for this unit
                    const dataSnapshot = await database.ref(unitId)
                        .orderByKey()
                        .limitToLast(1)
                        .once('value');
                    
                    let lastTimestamp = null;
                    
                    if (dataSnapshot.exists()) {
                        dataSnapshot.forEach(child => {
                            const key = child.key;
                            // Skip placeholder keys
                            if (key !== 'initialized' && key !== 'timestamp') {
                                // Extract timestamp from key (format: YYYY-MM-DD_HH-MM-SS)
                                try {
                                    const timestampMatch = key.match(/(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})/);
                                    if (timestampMatch) {
                                        const dateStr = timestampMatch[1];
                                        const timeStr = timestampMatch[2].replace(/-/g, ':');
                                        lastTimestamp = new Date(`${dateStr}T${timeStr}`).getTime();
                                    }
                                } catch (e) {
                                    console.warn(`Could not parse timestamp from key: ${key}`);
                                }
                            }
                        });
                    }
                    
                    // Update tracking
                    if (lastTimestamp) {
                        unitLastDataTimestamp[unitId] = lastTimestamp;
                        
                        const timeSinceLastData = currentTime - lastTimestamp;
                        
                        // Check if data is stale
                        if (timeSinceLastData > DATA_FLOW_CONFIG.STALE_DATA_THRESHOLD) {
                            staleUnits.push({
                                id: unitId,
                                name: unitData.name || unitId,
                                timeSinceLastData: formatTimeSince(timeSinceLastData)
                            });
                        }
                    } else if (unitLastDataTimestamp[unitId]) {
                        // No recent data but had data before
                        const timeSinceLastData = currentTime - unitLastDataTimestamp[unitId];
                        
                        if (timeSinceLastData > DATA_FLOW_CONFIG.STALE_DATA_THRESHOLD) {
                            staleUnits.push({
                                id: unitId,
                                name: unitData.name || unitId,
                                timeSinceLastData: formatTimeSince(timeSinceLastData)
                            });
                        }
                    }
                } catch (error) {
                    console.error(`Error checking data flow for unit ${unitId}:`, error);
                }
            })();
            
            checkPromises.push(checkPromise);
        });
        
        // Wait for all checks to complete
        await Promise.all(checkPromises);
        
        // Show alert if any units have stale data
        showDataFlowAlert(staleUnits);
        
    } catch (error) {
        console.error('Error in data flow monitoring:', error);
    }
}

/**
 * Initializes data flow monitoring
 * Call this function after authentication is verified
 */
function initializeDataFlowMonitoring() {
    console.log('🔍 Data flow monitoring initialized');
    
    // Clear any existing interval
    if (dataFlowIntervalId) {
        clearInterval(dataFlowIntervalId);
        dataFlowIntervalId = null;
    }
    
    // Initial check
    checkDataFlow();
    
    // Set up periodic checking
    dataFlowIntervalId = setInterval(checkDataFlow, DATA_FLOW_CONFIG.CHECK_INTERVAL);
}

/**
 * Stops data flow monitoring
 */
function stopDataFlowMonitoring() {
    if (dataFlowIntervalId) {
        clearInterval(dataFlowIntervalId);
        dataFlowIntervalId = null;
        console.log('🔍 Data flow monitoring stopped');
    }
}

// ============================================================================
// MOBILE-OPTIMIZED MAIN APPLICATION LOGIC
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Toast Styles
    injectToastStyles();

    // UI Elements for Admin Dashboard
    const logoutButton = document.getElementById('logout-button');
    const userEmailSpan = document.getElementById('user-email');
    const adminContent = document.getElementById('admin-content');

    const addUnitForm = document.getElementById('add-unit-form');
    const unitIdInput = document.getElementById('unit-id');
    const unitNameInput = document.getElementById('unit-name');
    const unitDescriptionInput = document.getElementById('unit-description');
    const addUnitMessage = document.getElementById('add-unit-message');

    const reportDateInput = document.getElementById('report-date');
    const reportUnitSelect = document.getElementById('report-unit');
    const generateReportButton = document.getElementById('generate-report-button');
    const reportOutput = document.getElementById('report-output');
    const reportUnitNameSpan = document.getElementById('report-unit-name');
    const reportSelectedDateSpan = document.getElementById('report-selected-date');
    const reportDataTableBody = reportOutput ? reportOutput.querySelector('tbody') : null;
    const existingUnitsContainer = document.getElementById('existing-units-container');
    const reportAlertsContainer = document.getElementById('report-alerts');

    // Set today's date as default for report
    const today = new Date();
    if (reportDateInput) {
        reportDateInput.value = today.toISOString().split('T')[0];
    }

    // ========================================================================
    // MOBILE-OPTIMIZED AUTHENTICATION - ANTI-LOOP PROTECTION
    // ========================================================================
    
    console.log('📱 Mobile-optimized authentication initialized');
    
    // MOBILE FIX: Enhanced auth state handler with anti-loop protection
    if (auth && typeof auth.onAuthStateChanged === 'function') {
        auth.onAuthStateChanged(async user => {
            // Prevent multiple simultaneous auth processing
            if (authProcessing) {
                console.log('⏳ Auth processing in progress, skipping...');
                return;
            }
            
            authProcessing = true;
            console.log('🔄 Auth state changed in dashboard:', user ? user.email : 'No user');
            
            if (!user) {
                console.log('🚫 No user, redirecting to login');
                authProcessing = false;
                // MOBILE FIX: Add delay for mobile stability
                setTimeout(() => {
                    window.location.href = 'admin.html';
                }, 1000);
                return;
            }
            
            try {
                const isAdmin = await checkAdminStatus(user);
                console.log('📊 Admin status:', isAdmin);
                
                if (!isAdmin) {
                    console.log('⛔ Not admin, redirecting to login');
                    showToast('Access Denied: You are not an administrator', 'danger');
                    authProcessing = false;
                    
                    // Stop data flow monitoring
                    stopDataFlowMonitoring();
                    
                    // MOBILE FIX: Add delay and sign out for mobile
                    setTimeout(async () => {
                        await auth.signOut();
                        window.location.href = 'admin.html';
                    }, 1500);
                    return;
                }
                
                // User is admin - now check if Super Admin
                const isSuperAdmin = await checkSuperAdminStatus(user);
                console.log('👑 Super Admin status:', isSuperAdmin);
                
                // Toggle Super Admin UI elements
                toggleSuperAdminUI(isSuperAdmin);
                
                // Load all admins if user is Super Admin
                if (isSuperAdmin) {
                    loadAllAdmins();
                }
                
                // User is admin - show dashboard
                showToast(`Welcome back, ${user.email}!${isSuperAdmin ? ' (Super Admin)' : ''}`, 'success');
                if (userEmailSpan) userEmailSpan.textContent = user.email;
                if (adminContent) adminContent.classList.remove('hidden');
                populateUnitSelect();
                renderExistingUnits();
                initializeDataFlowMonitoring();
                
            } catch (error) {
                console.error('❌ Auth error:', error);
                showToast('Authentication error occurred', 'danger');
                authProcessing = false;
                
                // Stop data flow monitoring
                stopDataFlowMonitoring();
                
                setTimeout(() => {
                    window.location.href = 'admin.html';
                }, 1000);
            }
            
            authProcessing = false;
        });
    } else {
        console.error('❌ Firebase auth is not available');
        showToast('Authentication system error', 'danger');
    }

    // ========================================================================
    // UNIT MANAGEMENT
    // ========================================================================

    if (addUnitForm) {
        addUnitForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            if (addUnitMessage) {
                addUnitMessage.innerHTML = '';
            }

            const unitId = unitIdInput ? unitIdInput.value.trim() : '';
            const unitName = unitNameInput ? unitNameInput.value.trim() : '';
            const unitDescription = unitDescriptionInput ? unitDescriptionInput.value.trim() : '';

            if (!unitId || !unitName) {
                showAlert('add-unit-message', 'warning', 'Unit ID and Unit Name are required.');
                return;
            }

            const validation = validateUnitId(unitId);
            if (!validation.valid) {
                showAlert('add-unit-message', 'warning', validation.error);
                return;
            }

            const latitudeInput = prompt('Enter latitude for this unit (e.g., 14.1130):');
            if (latitudeInput === null) return;
            
            const longitudeInput = prompt('Enter longitude for this unit (e.g., 121.5503):');
            if (longitudeInput === null) return;

            const latitude = parseFloat(latitudeInput);
            const longitude = parseFloat(longitudeInput);

            if (isNaN(latitude) || isNaN(longitude)) {
                showAlert('add-unit-message', 'warning', 'Latitude and longitude must be valid numbers.');
                return;
            }

            if (latitude < -90 || latitude > 90) {
                showAlert('add-unit-message', 'warning', 'Latitude must be between -90 and 90.');
                return;
            }

            if (longitude < -180 || longitude > 180) {
                showAlert('add-unit-message', 'warning', 'Longitude must be between -180 and 180.');
                return;
            }

            showLoading('add-unit-message', 'Adding unit...');

            try {
                const unitMetadataRef = database.ref(`unitsMetadata/${unitId}`);
                const metadataSnapshot = await unitMetadataRef.once('value');

                if (metadataSnapshot.exists()) {
                    hideLoading('add-unit-message');
                    showAlert('add-unit-message', 'warning', `Unit ID '${unitId}' already exists in metadata.`);
                    showToast(`Unit '${unitId}' already exists`, 'warning');
                    return;
                }

                const unitDataRef = database.ref(`${unitId}`);
                const dataSnapshot = await unitDataRef.once('value');
                
                if (dataSnapshot.exists()) {
                    console.warn(`Warning: A data node for '${unitId}' already exists.`);
                } else {
                    await unitDataRef.set({ 
                        "initialized": true, 
                        "timestamp": new Date().toISOString() 
                    });
                    console.log(`Placeholder data node for '${unitId}' created.`);
                }

                await unitMetadataRef.set({
                    name: unitName,
                    description: unitDescription,
                    latitude: latitude,
                    longitude: longitude,
                    createdAt: new Date().toISOString(),
                    addedBy: auth.currentUser ? auth.currentUser.email : 'unknown'
                });

                hideLoading('add-unit-message');
                showAlert('add-unit-message', 'success', 
                    `Unit '${unitName}' (ID: ${unitId}) added successfully with coordinates (${latitude}, ${longitude})!`);
                showToast(`Unit '${unitName}' added successfully!`, 'success');
                
                if (addUnitForm) addUnitForm.reset();
                renderExistingUnits();
                populateUnitSelect();

            }  catch (error) {
                console.error("Error adding unit:", error);
                hideLoading('add-unit-message');
                
                let errorMessage = 'Unknown error occurred';
                
                // Customize error messages based on error code
                if (error.code === 'PERMISSION_DENIED' || error.message.includes('permission_denied')) {
                    errorMessage = `The unit ID '${unitId}' does not exist in your Firebase database. Please make sure the unit is available and already sending data in your Database`;
                } else if (error.message) {
                    errorMessage = error.message;
                }
                
                showAlert('add-unit-message', 'danger', 
                    `Error adding unit: ${errorMessage}`);
                showToast(`Failed to add unit: ${errorMessage}`, 'danger');
            }
        });
    }

    /**
     * Creates HTML for an existing unit card
     */
    function createExistingUnitCard(unitId, unitName, unitDescription, latitude, longitude) {
        return `
        <div class="col-lg-6 col-md-12" id="admin-card-${unitId}">
          <div class="card shadow-sm border-0">
            <div class="card-body">
              <h5 class="card-title fw-bold">${unitName} <small class="text-muted">(ID: ${unitId})</small></h5>
              <p class="card-text" id="desc-${unitId}">${unitDescription || 'No description provided.'}</p>
              <p class="card-text small text-muted">
                <i class="fas fa-map-marker-alt me-1"></i>
                Coordinates: ${latitude || 'N/A'}, ${longitude || 'N/A'}
              </p>
              <div class="d-flex gap-2">
                <button class="btn btn-primary btn-sm edit-unit-btn" 
                        data-unit-id="${unitId}" 
                        data-unit-name="${unitName}" 
                        data-unit-description="${unitDescription || ''}">
                    <i class="fas fa-edit me-1"></i> Edit
                </button>
                <button class="btn btn-danger btn-sm delete-unit-btn" 
                        data-unit-id="${unitId}">
                    <i class="fas fa-trash me-1"></i> Delete
                </button>
              </div>
            </div>
          </div>
        </div>
        `;
    }

    /**
     * Renders all existing units from Firebase
     */
    function renderExistingUnits() {
        const existingUnitsContainer = document.getElementById("existing-units-container");
        
        if (!existingUnitsContainer) {
            console.error('Existing units container not found');
            return;
        }

        showLoading('existing-units-container', 'Loading units...');

        database.ref("unitsMetadata").once("value")
            .then((snapshot) => {
                const units = snapshot.val();
                
                existingUnitsContainer.innerHTML = "";

                if (!units) {
                    existingUnitsContainer.innerHTML = "<p class='text-center text-muted'>No units found.</p>";
                    return;
                }

                for (const [unitId, unitData] of Object.entries(units)) {
                    const unitCard = createExistingUnitCard(
                        unitId, 
                        unitData.name, 
                        unitData.description, 
                        unitData.latitude, 
                        unitData.longitude
                    );
                    existingUnitsContainer.insertAdjacentHTML("beforeend", unitCard);
                }

                // ✅ FIXED: Single event listener attachment for edit buttons
                document.querySelectorAll('.edit-unit-btn').forEach(button => {
                    button.addEventListener('click', handleEditUnitClick);
                });

                // ✅ FIXED: Single event listener attachment for delete buttons
                document.querySelectorAll('.delete-unit-btn').forEach(button => {
                    button.addEventListener('click', handleDeleteUnitClick);
                });

            })
            .catch((error) => {
                console.error("Error rendering units:", error);
                existingUnitsContainer.innerHTML = `
                    <div class="alert alert-danger" role="alert">
                        Error loading units: ${error.message}
                    </div>
                `;
            });
    }

    /**
     * ✅ FIXED: Handles edit unit button click
     */
    async function handleEditUnitClick(e) {
        const unitId = e.currentTarget.dataset.unitId;
        console.log('✏️ Edit button clicked for unit:', unitId);
        
        // Fetch current coordinates from Firebase
        try {
            const unitSnapshot = await database.ref(`unitsMetadata/${unitId}`).once('value');
            
            if (!unitSnapshot.exists()) {
                showModal('Error', `Unit metadata for '${unitId}' not found in database.`);
                showToast(`Unit '${unitId}' not found`, 'danger');
                return;
            }
            
            const unitData = unitSnapshot.val();
            console.log('📋 Current unit data:', unitData);
            
            // Populate the edit modal with current data
            document.getElementById('edit-unit-id').value = unitId;
            document.getElementById('edit-unit-name').value = unitData.name || '';
            document.getElementById('edit-unit-description').value = unitData.description || '';
            document.getElementById('edit-unit-latitude').value = unitData.latitude || '';
            document.getElementById('edit-unit-longitude').value = unitData.longitude || '';
            
            console.log('📝 Modal populated with:', {
                name: unitData.name,
                lat: unitData.latitude,
                lng: unitData.longitude
            });
            
            // Show the modal
            const editModal = new bootstrap.Modal(document.getElementById('editUnitModal'));
            editModal.show();
            
        } catch (error) {
            console.error('❌ Error fetching unit data for editing:', error);
            showModal('Error', `Failed to load unit data: ${error.message}`);
            showToast(`Failed to load unit: ${error.message}`, 'danger');
        }
    }

    /**
     * ✅ FIXED: Handles delete unit button click
     */
    function handleDeleteUnitClick(e) {
        const unitId = e.currentTarget.dataset.unitId;
        
        showModal(
            'Confirm Delete', 
            `Are you sure you want to delete unit "${unitId}"? This action cannot be undone.`,
            () => deleteUnit(unitId),
            true
        );
    }

    // ✅ FIXED: Edit unit form submission - PROPERLY ATTACHED
    const editUnitForm = document.getElementById('edit-unit-form');
    if (editUnitForm) {
        editUnitForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('🔄 Edit form submitted');
            
            const unitId = document.getElementById('edit-unit-id').value;
            const name = document.getElementById('edit-unit-name').value;
            const description = document.getElementById('edit-unit-description').value;
            const latitude = parseFloat(document.getElementById('edit-unit-latitude').value);
            const longitude = parseFloat(document.getElementById('edit-unit-longitude').value);

            console.log('📝 Edit data:', { unitId, name, description, latitude, longitude });

            if (!unitId) {
                showToast('Error: Unit ID is missing', 'danger');
                return;
            }

            if (isNaN(latitude) || isNaN(longitude)) {
                showToast('Please enter valid latitude and longitude values', 'danger');
                return;
            }

            const submitBtn = editUnitForm.querySelector('button[type="submit"]');
            const originalText = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

            try {
                console.log(`🔄 Updating unit ${unitId} in Firebase...`);
                
                // Update Firebase
                const updates = {
                    name: name,
                    description: description,
                    latitude: latitude,
                    longitude: longitude,
                    updatedAt: new Date().toISOString()
                };
                
                console.log('📤 Firebase update payload:', updates);
                
                await database.ref(`unitsMetadata/${unitId}`).update(updates);
                
                console.log('✅ Firebase update successful');

                // Close modal & refresh
                const modalEl = document.getElementById('editUnitModal');
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();

                // Refresh the units display
                renderExistingUnits();
                populateUnitSelect();
                
                showToast(`Unit '${name}' updated successfully!`, 'success');
                
            } catch (error) {
                console.error('❌ Error updating unit:', error);
                showToast(`Failed to update: ${error.message}`, 'danger');
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
            }
        });
    }

    /**
     * Deletes a unit after validation
     */
    async function deleteUnit(unitId) {
        try {
            const unitDataRef = database.ref(`${unitId}`);
            const dataSnapshot = await unitDataRef.once('value');
            const unitData = dataSnapshot.val();

            let hasRealSensorData = false;
            
            if (unitData) {
                const keys = Object.keys(unitData);
                if (keys.length > 2 || (keys.length === 2 && (!keys.includes("initialized") || !keys.includes("timestamp")))) {
                    hasRealSensorData = true;
                } else if (keys.length === 1 && keys[0] !== "initialized" && keys[0] !== "timestamp") {
                    hasRealSensorData = true;
                }
                
                if (dataSnapshot.hasChildren()) {
                    dataSnapshot.forEach(child => {
                        if (child.key !== "initialized" && child.key !== "timestamp") {
                            hasRealSensorData = true;
                            return true;
                        }
                    });
                }
            }
            
            if (hasRealSensorData) {
                showModal('Cannot Delete', 
                    `Cannot delete unit '${unitId}'. It contains real sensor data.`);
                showToast(`Deletion failed: '${unitId}' has sensor data`, 'warning');
                return;
            }

            await database.ref(`unitsMetadata/${unitId}`).remove();
            console.log(`Unit metadata for '${unitId}' deleted successfully.`);

            await unitDataRef.remove();
            console.log(`Placeholder data node for '${unitId}' deleted successfully.`);

            renderExistingUnits();
            populateUnitSelect();
            
            showModal('Success', `Unit '${unitId}' successfully deleted (no real sensor data was present).`);
            showToast(`Unit '${unitId}' deleted successfully!`, 'success');

        } catch (error) {
            console.error("Error deleting unit:", error);
            showModal('Error', `Error deleting unit '${unitId}': ${error.message}`);
            showToast(`Error deleting unit: ${error.message}`, 'danger');
        }
    }

    // ========================================================================
    // DAILY REPORTING
    // ========================================================================

    /**
     * *** MODIFIED *** - Populates the unit select dropdown with combined report option
     */
    async function populateUnitSelect() {
        if (!reportUnitSelect) return;
        
        reportUnitSelect.innerHTML = '<option value="">-- Select Unit --</option>';
        
        try {
            const snapshot = await database.ref('unitsMetadata').once('value');
            
            if (snapshot.exists()) {
                const unitsData = snapshot.val();
                
                // Add individual units
                snapshot.forEach(childSnapshot => {
                    const unitId = childSnapshot.key;
                    const unitData = childSnapshot.val();
                    const option = document.createElement('option');
                    option.value = unitId;
                    option.textContent = unitData.name || unitId;
                    reportUnitSelect.appendChild(option);
                });
                
                // *** NEW: Add combined report option if both unit_1 and unit_2 exist ***
                if (unitsData['unit_1'] && unitsData['unit_2']) {
                    const combinedOption = document.createElement('option');
                    combinedOption.value = 'combined';
                    combinedOption.textContent = '📊 Generate Combined Report (Unit 1 + Unit 2)';
                    combinedOption.style.fontWeight = 'bold';
                    combinedOption.style.backgroundColor = '#e3f2fd';
                    reportUnitSelect.appendChild(combinedOption);
                }
            }
        } catch (error) {
            console.error("Error populating unit select:", error);
            showModal('Error', `Failed to load units for reporting: ${error.message}`);
        }
    }

    /**
     * Checks readings against thresholds and displays alerts
     */
    function checkAndNotifyBadReadings(calculatedMetrics, unitName) {
        if (!reportAlertsContainer) return;
        
        reportAlertsContainer.innerHTML = '';
        let hasBadReadings = false;
        let alertMessages = [];

        for (const metricName in calculatedMetrics) {
            const avg = calculatedMetrics[metricName].avg;
            const thresholds = BAD_READING_THRESHOLDS[metricName];

            if (thresholds && avg !== 'N/A') {
                if (thresholds.min !== undefined && avg < thresholds.min) {
                    alertMessages.push(`${metricName} (Avg: ${avg.toFixed(2)}) is below acceptable levels (< ${thresholds.min}).`);
                    hasBadReadings = true;
                }
                if (thresholds.max !== undefined && avg > thresholds.max) {
                    alertMessages.push(`${metricName} (Avg: ${avg.toFixed(2)}) is above acceptable levels (> ${thresholds.max}).`);
                    hasBadReadings = true;
                }
            }
        }

        if (hasBadReadings) {
            const alertHtml = `
                <div class="alert alert-danger alert-dismissible fade show" role="alert">
                    <strong>Warning for ${unitName}!</strong> Potential issues detected in daily readings:
                    <ul>
                        ${alertMessages.map(msg => `<li>${msg}</li>`).join('')}
                    </ul>
                    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                </div>
            `;
            reportAlertsContainer.innerHTML = alertHtml;
            showToast(`Issues detected in ${unitName} readings`, 'danger');
        } else {
            const successHtml = `
                <div class="alert alert-success alert-dismissible fade show" role="alert">
                    <strong>All good!</strong> No critical issues detected in daily readings for ${unitName}.
                    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                </div>
            `;
            reportAlertsContainer.innerHTML = successHtml;
            showToast(`Report generated for ${unitName}: No issues detected`, 'success');
        }
    }

    /**
     * ✅ FIXED: Generates a daily report for a single unit
     */
    async function generateSingleUnitReport(selectedUnitId, selectedDate) {
        const selectedUnitName = document.getElementById('report-unit').options[document.getElementById('report-unit').selectedIndex].text;
        
        // Update UI
        if (reportUnitNameSpan) {
            reportUnitNameSpan.textContent = selectedUnitName;
        }
        if (reportSelectedDateSpan) {
            reportSelectedDateSpan.textContent = selectedDate;
        }
        if (reportDataTableBody) {
            reportDataTableBody.innerHTML = '<tr><td colspan="5" class="text-center"><div class="spinner-border text-primary" role="status"></div><p class="mt-2">Generating report...</p></td></tr>';
        }
        if (reportAlertsContainer) {
            reportAlertsContainer.innerHTML = '';
        }

        // Hide combined report table
        const combinedTable = document.getElementById("combined-report-table");
        if (combinedTable) {
            combinedTable.style.display = "none";
        }

        try {
            // ✅ FIXED: Query for data that starts with the selected date
            const unitSensorDataRef = database.ref(selectedUnitId);
            const snapshot = await unitSensorDataRef.orderByKey().once('value');

            let readingsForDay = [];

            if (snapshot.exists()) {
                snapshot.forEach(timestampSnapshot => {
                    const timestampKey = timestampSnapshot.key;
                    // ✅ FIXED: Better date filtering
                    if (timestampKey.startsWith(selectedDate) && 
                        timestampKey !== 'initialized' && 
                        timestampKey !== 'timestamp') {
                        
                        const val = timestampSnapshot.val();
                        if (val && typeof val === 'object') {
                            readingsForDay.push({
                                timestamp: timestampKey,
                                data: val
                            });
                        }
                    }
                });
            }

            console.log(`Found ${readingsForDay.length} readings for ${selectedDate}`);

            if (readingsForDay.length === 0) {
                if (reportDataTableBody) {
                    reportDataTableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No data found for this day and unit.</td></tr>';
                }
                showAlert('report-alerts', 'info', 
                    `No sensor data found for ${selectedUnitName} on ${selectedDate}.`);
                showToast(`No data found for ${selectedUnitName} on ${selectedDate}`, 'info');
                return;
            }

            // Process metrics
            const metrics = {
                'pH': [],
                'temperature': [],
                'turbidity': [],
                'tds': []
            };

            readingsForDay.forEach(reading => {
                const data = reading.data;
                const metricSuffix = selectedUnitId.split('_').pop();

                // ✅ FIXED: Handle different data structures
                const phValue = data[`ph_${metricSuffix}`] !== undefined ? data[`ph_${metricSuffix}`] : data.ph;
                const tempValue = data[`temperature_${metricSuffix}`] !== undefined ? data[`temperature_${metricSuffix}`] : data.temperature;
                const turbidityValue = data[`turbidity_${metricSuffix}`] !== undefined ? data[`turbidity_${metricSuffix}`] : data.turbidity;
                const tdsValue = data[`tds_${metricSuffix}`] !== undefined ? data[`tds_${metricSuffix}`] : data.tds;

                if (phValue !== undefined && phValue !== null && !isNaN(parseFloat(phValue))) {
                    metrics['pH'].push(parseFloat(phValue));
                }
                if (tempValue !== undefined && tempValue !== null && !isNaN(parseFloat(tempValue))) {
                    metrics['temperature'].push(parseFloat(tempValue));
                }
                if (turbidityValue !== undefined && turbidityValue !== null && !isNaN(parseFloat(turbidityValue))) {
                    metrics['turbidity'].push(parseFloat(turbidityValue));
                }
                if (tdsValue !== undefined && tdsValue !== null && !isNaN(parseFloat(tdsValue))) {
                    metrics['tds'].push(parseFloat(tdsValue));
                }
            });

            // Update table with download button
            if (reportDataTableBody) {
                reportDataTableBody.innerHTML = '';
                
                // Add download button row
                const downloadRow = reportDataTableBody.insertRow();
                const downloadCell = downloadRow.insertCell();
                downloadCell.colSpan = 5;
                downloadCell.className = 'text-center';
                downloadCell.innerHTML = `
                    <button class="btn btn-success btn-sm" id="download-single-report">
                        <i class="fas fa-download me-1"></i> Download Detailed Report (CSV)
                    </button>
                `;
                
                // Add download button event listener
                setTimeout(() => {
                    const downloadBtn = document.getElementById('download-single-report');
                    if (downloadBtn) {
                        downloadBtn.addEventListener('click', () => {
                            downloadSingleUnitReport(selectedUnitId, selectedUnitName, selectedDate, readingsForDay);
                        });
                    }
                }, 100);
            }

            const calculatedMetricsForAlert = {};

            for (const metricName in metrics) {
                const values = metrics[metricName].filter(val => !isNaN(val));
                let avg, min, max, count;

                if (values.length > 0) {
                    const sum = values.reduce((a, b) => a + b, 0);
                    avg = sum / values.length;
                    min = Math.min(...values);
                    max = Math.max(...values);
                    count = values.length;
                } else {
                    avg = 'N/A';
                    min = 'N/A';
                    max = 'N/A';
                    count = 0;
                }
                
                calculatedMetricsForAlert[metricName] = { avg, min, max, count };

                if (reportDataTableBody) {
                    const row = reportDataTableBody.insertRow();
                    row.insertCell().textContent = metricName;
                    row.insertCell().textContent = typeof avg === 'number' ? avg.toFixed(2) : avg;
                    row.insertCell().textContent = typeof min === 'number' ? min.toFixed(2) : min;
                    row.insertCell().textContent = typeof max === 'number' ? max.toFixed(2) : max;
                    row.insertCell().textContent = count;
                }
            }
            
            checkAndNotifyBadReadings(calculatedMetricsForAlert, selectedUnitName);
            showToast(`Report generated for ${selectedUnitName}`, 'success');

        } catch (error) {
            console.error("Error generating report:", error);
            
            if (reportDataTableBody) {
                reportDataTableBody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Error generating report: ${error.message}</td></tr>`;
            }
            
            showAlert('report-alerts', 'danger', 
                `<strong>Error!</strong> Failed to generate report: ${error.message}`);
            showToast('Failed to generate report', 'danger');
        }
    }

    // ✅ FIXED: Update the generate report button handler
    if (generateReportButton) {
        generateReportButton.addEventListener('click', async () => {
            const selectedDate = reportDateInput ? reportDateInput.value : '';
            const selectedUnitId = reportUnitSelect ? reportUnitSelect.value : '';

            // Validation
            if (!selectedDate) {
                showModal('Missing Information', 'Please select a date.');
                return;
            }

            // Check if "Combined Report" option is selected
            if (selectedUnitId === 'combined') {
                await generateCombinedReport(selectedDate);
                return;
            }

            if (!selectedUnitId) {
                showModal('Missing Information', 'Please select a unit.');
                return;
            }

            await generateSingleUnitReport(selectedUnitId, selectedDate);
        });
    }

    // ========================================================================
    // USER MANAGEMENT
    // ========================================================================

    const addUserForm = document.getElementById('addUserForm');
    const newEmailInput = document.getElementById('newEmail');
    const newPasswordInput = document.getElementById('newPassword');
    const addUserMessage = document.getElementById('addUserMessage');

    if (addUserForm) {
        addUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (addUserMessage) addUserMessage.innerHTML = '';

            const email = newEmailInput ? newEmailInput.value.trim() : '';
            const password = newPasswordInput ? newPasswordInput.value : '';

            // --- Validation ---
            if (!email || !password) {
                showAlert('addUserMessage', 'warning', 'Email and password are required.');
                return;
            }
            if (!validateEmail(email)) {
                showAlert('addUserMessage', 'warning', 'Please enter a valid email address.');
                return;
            }
            const passwordValidation = validatePassword(password);
            if (!passwordValidation.valid) {
                showAlert('addUserMessage', 'warning', passwordValidation.error);
                return;
            }

            const submitButton = addUserForm.querySelector('button[type="submit"]');
            if (submitButton) submitButton.disabled = true;
            showLoading('addUserMessage', 'Creating user...');

            let secondaryApp = null;

            try {
                // 1. PRESERVE CURRENT ADMIN
                const currentUser = auth.currentUser;
                if (!currentUser) throw new Error('You are not logged in.');

                // 2. DEFINE CONFIGURATION EXPLICITLY
                // We define this here to guarantee the secondary app works
                const secondaryConfig = {
                    apiKey: "AIzaSyDQL-6PMlYVED2I2KpYISiDaf4huUg9tZw",
                    authDomain: "thesis-1bda3.firebaseapp.com",
                    databaseURL: "https://thesis-1bda3-default-rtdb.asia-southeast1.firebasedatabase.app",
                    projectId: "thesis-1bda3",
                    storageBucket: "thesis-1bda3.firebasestorage.app",
                    messagingSenderId: "509024706594",
                    appId: "1:509024706594:web:4823234418f6a1d9b66a7b"
                };

                // 3. CREATE SECONDARY APP INSTANCE
                secondaryApp = firebase.initializeApp(secondaryConfig, "SecondaryApp_" + Date.now());
                const secondaryAuth = secondaryApp.auth();

                console.log(`🔄 Creating user via Secondary App: ${email}`);
                
                // 4. CREATE USER ON SECONDARY APP
                const userCredential = await secondaryAuth.createUserWithEmailAndPassword(email, password);
                const newUserUid = userCredential.user.uid;
                
                console.log(`✅ User created (UID: ${newUserUid})`);

                // 5. WRITE TO DATABASE USING MAIN ADMIN AUTH
                // We use the global 'database' var which is connected to the ADMIN user
                console.log(`🔄 key: Adding to database using admin: ${currentUser.email}`);
                
                const adminUserRef = database.ref(`adminUsers/${newUserUid}`);
                await adminUserRef.set({
                    email: email,
                    createdAt: new Date().toISOString(),
                    addedBy: currentUser.email,
                    isAdmin: true,
                    isSuperAdmin: false  // Regular admins cannot create Super Admins
                });

                console.log('✅ Database write successful');

                // 6. CLEAN UP
                await secondaryAuth.signOut();
                
                showAlert('addUserMessage', 'success', 
                    `✅ User ${email} created successfully! (Regular Admin)`);
                showToast(`New user ${email} created successfully!`, 'success');
                
                addUserForm.reset();

            } catch (error) {
                console.error('❌ Error process:', error);
                let errorMessage = error.message;
                
                if (error.code === 'auth/email-already-in-use') {
                    errorMessage = 'This email is already in use.';
                } else if (error.code === 'PERMISSION_DENIED') {
                    errorMessage = 'Permission denied. Your admin account cannot write to the database.';
                }

                showAlert('addUserMessage', 'danger', errorMessage);
                showToast(`Error creating user: ${errorMessage}`, 'danger');
            } finally {
                // Always delete the secondary app to free memory
                if (secondaryApp) {
                    try {
                        await secondaryApp.delete();
                    } catch (deleteError) {
                        console.warn('Failed to delete secondary app:', deleteError);
                    }
                }
                hideLoading('addUserMessage');
                if (submitButton) submitButton.disabled = false;
            }
        });
    }

    // ========================================================================
    // PASSWORD MANAGEMENT
    // ========================================================================

    const changePasswordForm = document.getElementById('changePasswordForm');
    const newAdminPasswordInput = document.getElementById('newAdminPassword');
    const confirmNewAdminPasswordInput = document.getElementById('confirmNewAdminPassword');
    const changePasswordMessage = document.getElementById('changePasswordMessage');
    const currentPasswordInput = document.getElementById('currentPassword');

    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const newPassword = newAdminPasswordInput.value;
            const confirmPassword = confirmNewAdminPasswordInput.value;
            const currentPassword = currentPasswordInput.value;

            if (changePasswordMessage) {
                changePasswordMessage.innerHTML = '';
            }

            if (newPassword !== confirmPassword) {
                showAlert('changePasswordMessage', 'danger', 'New passwords do not match.');
                return;
            }

            const passwordValidation = validatePassword(newPassword);
            if (!passwordValidation.valid) {
                showAlert('changePasswordMessage', 'danger', passwordValidation.error);
                return;
            }

            const user = auth.currentUser;

            if (!user) {
                showAlert('changePasswordMessage', 'danger', 'No user is currently signed in.');
                return;
            }

            showLoading('changePasswordMessage', 'Updating password...');

            try {
                await user.updatePassword(newPassword);
                
                hideLoading('changePasswordMessage');
                showAlert('changePasswordMessage', 'success', 'Password updated successfully!');
                showToast('Your password has been updated', 'success');
                
                newAdminPasswordInput.value = '';
                confirmNewAdminPasswordInput.value = '';
                currentPasswordInput.value = '';
                
            } catch (error) {
                console.error('Error changing password:', error);
                hideLoading('changePasswordMessage');
                
                let errorMessage = 'Failed to change password.';
                if (error.code === 'auth/requires-recent-login') {
                    errorMessage = 'Please sign in again to change your password. Your session has expired.';
                } else if (error.code === 'auth/weak-password') {
                    errorMessage = 'The new password is too weak. It must be at least 6 characters long.';
                }
                
                showAlert('changePasswordMessage', 'danger', 
                    `${errorMessage} (${error.message})`);
                showToast(errorMessage, 'danger');
            }
        });
    }

    // ========================================================================
    // SUPER ADMIN FUNCTIONALITY
    // ========================================================================

    // Super Admin form submission
    const addAdminForm = document.getElementById('add-admin-form');
    if (addAdminForm) {
        addAdminForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('admin-email').value.trim();
            const password = document.getElementById('admin-password').value;
            const isSuperAdmin = document.getElementById('make-super-admin').checked;
            
            // Validation
            if (!email || !password) {
                showToast('Email and password are required', 'warning');
                return;
            }
            
            if (password.length < 6) {
                showToast('Password must be at least 6 characters', 'warning');
                return;
            }
            
            try {
                await addUserAsSuperAdmin(email, password, isSuperAdmin);
                showToast(`Administrator ${email} created successfully!${isSuperAdmin ? ' (Super Admin)' : ''}`, 'success');
                
                // Reset form
                addAdminForm.reset();
                
                // Refresh admin list
                loadAllAdmins();
                
            } catch (error) {
                console.error('Error creating admin:', error);
                let errorMessage = error.message;
                
                if (error.code === 'auth/email-already-in-use') {
                    errorMessage = 'This email is already registered.';
                }
                
                showToast(`Failed to create administrator: ${errorMessage}`, 'danger');
            }
        });
    }

    // Delete admin confirmation
    const confirmDeleteBtn = document.getElementById('confirm-delete-admin');
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', () => {
            if (window.adminToDelete) {
                removeAdministrator(window.adminToDelete.uid);
                window.adminToDelete = null;
            }
        });
    }

    // Cleanup when delete modal is closed
    const deleteAdminModal = document.getElementById('deleteAdminModal');
    if (deleteAdminModal) {
        deleteAdminModal.addEventListener('hidden.bs.modal', () => {
            window.adminToDelete = null;
        });
    }

    // ========================================================================
    // NAVIGATION MANAGEMENT
    // ========================================================================

    // Navigation Functions
    function hideAllSections() {
        const sections = ['unit-management-section', 'daily-reports-section', 'admin-management-section', 'super-admin-section'];
        const navItems = ['nav-units', 'nav-reports', 'nav-admin-management', 'nav-manage-admins'];
        
        sections.forEach(sectionId => {
            const section = document.getElementById(sectionId);
            if (section) section.classList.add('hidden');
        });
        
        navItems.forEach(navId => {
            const nav = document.getElementById(navId);
            if (nav) nav.classList.remove('active');
        });
    }

    function showUnitsSection() {
        hideAllSections();
        document.getElementById('unit-management-section').classList.remove('hidden');
        document.getElementById('nav-units').classList.add('active');
    }

    function showReportsSection() {
        hideAllSections();
        document.getElementById('daily-reports-section').classList.remove('hidden');
        document.getElementById('nav-reports').classList.add('active');
    }

    function showAdminManagementSection() {
        hideAllSections();
        document.getElementById('admin-management-section').classList.remove('hidden');
        document.getElementById('nav-admin-management').classList.add('active');
    }

    function showSuperAdminSection() {
        hideAllSections();
        document.getElementById('super-admin-section').classList.remove('hidden');
        document.getElementById('nav-manage-admins').classList.add('active');
        
        // Load admins list when section is shown
        loadAllAdmins();
    }

    // Navigation Setup
    const navUnits = document.getElementById('nav-units');
    const navReports = document.getElementById('nav-reports');
    const navAdminManagement = document.getElementById('nav-admin-management');
    const navManageAdmins = document.getElementById('nav-manage-admins');
    
    if (navUnits) {
        navUnits.addEventListener('click', (e) => {
            e.preventDefault();
            showUnitsSection();
        });
    }
    
    if (navReports) {
        navReports.addEventListener('click', (e) => {
            e.preventDefault();
            showReportsSection();
        });
    }
    
    if (navAdminManagement) {
        navAdminManagement.addEventListener('click', (e) => {
            e.preventDefault();
            showAdminManagementSection();
        });
    }
    
    if (navManageAdmins) {
        navManageAdmins.addEventListener('click', (e) => {
            e.preventDefault();
            showSuperAdminSection();
        });
    }

    // ========================================================================
    // MOBILE-OPTIMIZED LOGOUT FUNCTIONALITY
    // ========================================================================

    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            console.log('🚪 Logout button clicked');
            
            // MOBILE FIX: Prevent multiple simultaneous logout attempts
            if (authProcessing) {
                console.log('⏳ Auth processing in progress, skipping logout...');
                return;
            }
            
            authProcessing = true;
            
            try {
                logoutButton.disabled = true;
                logoutButton.textContent = '🔄 Logging out...';
                
                // Stop data flow monitoring
                stopDataFlowMonitoring();
                
                await auth.signOut();
                
                console.log('✅ Successfully signed out');
                
                // MOBILE FIX: Reset auth processing flag
                authProcessing = false;
                
                showToast('Logged out successfully', 'info');
                
                // MOBILE FIX: Add delay for mobile stability
                setTimeout(() => {
                    window.location.href = 'admin.html';
                }, 1000);
                
            } catch (error) {
                console.error('❌ Logout error:', error);
                
                // MOBILE FIX: Reset auth processing flag on error
                authProcessing = false;
                
                logoutButton.disabled = false;
                logoutButton.textContent = '🚪 Logout';
                
                showAlert('report-alerts', 'danger', 
                    `Logout failed: ${error.message}. Please try refreshing the page.`);
                showToast('Logout failed', 'danger');
            }
        });
        
        console.log('✅ Logout button handler attached');
    } else {
        console.error('❌ Logout button not found in DOM');
    }

    // MOBILE FIX: Clear any stuck processing state on page visibility change
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            console.log('📱 Page became visible, resetting auth processing state');
            // Reset processing state when user returns to the tab
            authProcessing = false;
        }
    });

    console.log('✅ Super Admin System initialized successfully');
});