// ============================================
// RASUMI GROUP — MAIN JS
// Handles: navbar scroll, smooth scroll, theme toggle
// ============================================

// Navbar scroll effect
const scrollContainer = document.querySelector('.scroll-container');

if (scrollContainer) {
    const nav = document.getElementById('navbar');

    // Function to check if we are on a subpage that needs a fixed navbar background
    const checkNavState = () => {
        const path = window.location.pathname;
        const isSubPage = path.includes('/contact/') || path.includes('/about/') || path.includes('/services/') || path.includes('/legal/') || path.includes('legal.html');

        // If it's a sub-page, always show scrolled state. Otherwise (Home Page), toggle based on scroll.
        if (isSubPage) {
            nav.classList.add('scrolled');
        } else {
            if (scrollContainer.scrollTop > 50) {
                nav.classList.add('scrolled');
            } else {
                nav.classList.remove('scrolled');
            }
        }
    };

    scrollContainer.addEventListener('scroll', checkNavState);
    checkNavState(); // Initial check on load
}

// Smooth scroll for links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        const container = document.querySelector('.scroll-container');
        if (target && container) {
            container.scrollTo({
                top: target.offsetTop,
                behavior: 'smooth'
            });
        }
    });
});


// Theme Toggle Logic
const toggleSwitch = document.querySelector('.theme-switch input[type="checkbox"]');
const currentTheme = localStorage.getItem('theme');

if (currentTheme) {
    document.body.setAttribute('data-theme', currentTheme);
    if (toggleSwitch && currentTheme === 'light') {
        toggleSwitch.checked = true;
    } else if (toggleSwitch && currentTheme === 'dark') {
        toggleSwitch.checked = false;
    }
} else {
    // Default to Light and checked
    if (toggleSwitch) toggleSwitch.checked = true;
}

function switchTheme(e) {
    if (e.target.checked) {
        document.body.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
    } else {
        document.body.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    }
}

if (toggleSwitch) {
    toggleSwitch.addEventListener('change', switchTheme, false);
}
