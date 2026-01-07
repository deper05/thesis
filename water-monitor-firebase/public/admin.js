// UI Elements
const authSection = document.getElementById('auth-section');
const adminContent = document.getElementById('admin-content');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginButton = document.getElementById('login-button');
const logoutButton = document.getElementById('logout-button');
const loginError = document.getElementById('login-error');

// --- Authentication State Listener ---
// This function runs whenever the user's sign-in status changes
auth.onAuthStateChanged(user => {
    if (user) {
        // User is signed in.
        console.log('User signed in:', user.email);
        authSection.classList.add('hidden'); // Hide login form
        adminContent.classList.remove('hidden'); // Show admin content
        loginError.classList.add('hidden'); // Hide any previous errors
    } else {
        // User is signed out.
        console.log('User signed out.');
        authSection.classList.remove('hidden'); // Show login form
        adminContent.classList.add('hidden'); // Hide admin content
    }
});

// --- Login Functionality ---
loginButton.addEventListener('click', () => {
    const email = emailInput.value;
    const password = passwordInput.value;

    if (!email || !password) {
        loginError.textContent = 'Please enter both email and password.';
        loginError.classList.remove('hidden');
        return;
    }

    auth.signInWithEmailAndPassword(email, password)
        .then((userCredential) => {
            // Signed in successfully, onAuthStateChanged will handle UI update
            console.log('Login successful for:', userCredential.user.email);
        })
        .catch((error) => {
            // Handle Errors here.
            const errorMessage = error.message;
            console.error('Login error:', errorMessage);
            loginError.textContent = errorMessage;
            loginError.classList.remove('hidden');
        });
});

// --- Logout Functionality ---
logoutButton.addEventListener('click', () => {
    auth.signOut().then(() => {
        // Sign-out successful, onAuthStateChanged will handle UI update
        console.log('User signed out successfully.');
    }).catch((error) => {
        // An error happened.
        console.error('Logout error:', error);
        alert('Logout failed: ' + error.message); // Simple alert for logout errors
    });
});
