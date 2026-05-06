// ============================================
// RASUMI GROUP — MOBILE JS
// Only loaded by mobile/index.html
// ============================================

document.addEventListener('DOMContentLoaded', () => {

    // Navbar scroll effect
    const container = document.querySelector('.scroll-container');
    const nav = document.getElementById('navbar');

    if (container && nav) {
        container.addEventListener('scroll', () => {
            if (container.scrollTop > 50) {
                nav.classList.add('scrolled');
            } else {
                nav.classList.remove('scrolled');
            }
        });
    }

    // Smooth scroll for nav links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target && container) {
                container.scrollTo({
                    top: target.offsetTop,
                    behavior: 'smooth'
                });
            }
        });
    });

    // Firefox scroll-snap fix
    if (container) {
        let isScrolling = false;
        container.addEventListener('wheel', (e) => {
            if (isScrolling) {
                e.preventDefault();
                return;
            }
            isScrolling = true;
            setTimeout(() => { isScrolling = false; }, 800);
        }, { passive: false });
    }

});
