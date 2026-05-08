// ============================================
// RASUMI GROUP â€” MAIN JS
// Handles: navbar scroll, smooth scroll, theme toggle
// ============================================

// Navbar scroll effect
const scrollContainer = document.querySelector('.scroll-container');

if (scrollContainer) {
    const nav = document.getElementById('navbar');
    let ticking = false;

    const checkNavState = () => {
        const path = window.location.pathname;
        const isSubPage = path.includes('/contact/') || path.includes('/about/') || path.includes('/services/') || path.includes('/legal/') || path.includes('legal.html');

        if (isSubPage) {
            nav.classList.add('scrolled');
        } else {
            if (scrollContainer.scrollTop > 50) {
                nav.classList.add('scrolled');
            } else {
                nav.classList.remove('scrolled');
            }
        }
        ticking = false;
    };

    scrollContainer.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(checkNavState);
            ticking = true;
        }
    }, { passive: true });

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
    document.documentElement.setAttribute('data-theme', currentTheme);
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
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
    } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    }
}

if (toggleSwitch) {
    toggleSwitch.addEventListener('change', switchTheme, false);
}

// ============================================
// IMAGE PROTECTION — Disable right-click & drag
// ============================================
(function protectImages() {

    // Disable right-click on all images
    document.addEventListener('contextmenu', function(e) {
        if (e.target.tagName === 'IMG') {
            e.preventDefault();
            return false;
        }
    });

    // Disable drag on all images
    document.addEventListener('dragstart', function(e) {
        if (e.target.tagName === 'IMG') {
            e.preventDefault();
            return false;
        }
    });

    // Apply CSS protection to all images
    const style = document.createElement('style');
    style.innerHTML = `
        img {
            -webkit-user-select: none;
            -moz-user-select: none;
            user-select: none;
            -webkit-user-drag: none;
            pointer-events: none;
        }
        a img {
            pointer-events: auto;
        }
    `;
    document.head.appendChild(style);

})();
