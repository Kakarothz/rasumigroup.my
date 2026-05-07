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

    // Mobile Menu Logic
    const hamburger = document.getElementById('hamburger');
    const closeMenu = document.getElementById('closeMenu');
    const mobileMenu = document.getElementById('mobileMenu');
    const menuLinks = document.querySelectorAll('.menu-links a, .menu-cta');

    if (hamburger && mobileMenu) {
        hamburger.addEventListener('click', () => {
            mobileMenu.classList.add('active');
        });
    }

    if (closeMenu) {
        closeMenu.addEventListener('click', () => {
            mobileMenu.classList.remove('active');
        });
    }

    // Close menu when clicking links
    menuLinks.forEach(link => {
        link.addEventListener('click', () => {
            mobileMenu.classList.remove('active');
        });
    });

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

    // --- Progressive Magnifying Scale Logic ---
    const marqueeCards = document.querySelectorAll('.marquee-card');
    
    function updateActiveCard() {
        const screenWidth = window.innerWidth;
        const screenCenter = screenWidth / 2;
        const startScalingAt = screenWidth / 2 + 100; // Mula membesar sebaik masuk (dengan buffer sikit)

        marqueeCards.forEach(card => {
            const rect = card.getBoundingClientRect();
            const cardCenter = rect.left + rect.width / 2;
            const distanceFromCenter = Math.abs(cardCenter - screenCenter);
            
            if (distanceFromCenter < startScalingAt) {
                // Kira progress (0 di tepi skrin, 1 di tengah skrin)
                let progress = 1 - (distanceFromCenter / startScalingAt);
                progress = Math.max(0, Math.min(1, progress));
                
                // 1. Skala Card (1.0 -> 1.1)
                const scale = 1 + (0.1 * progress);
                
                // 2. Skala Neon Blur (1px -> 10px)
                const blur = 1 + (9 * progress);
                
                // Apply Style Dinamik
                card.style.transform = `scale(${scale})`;
                
                // Cek Mode (Neon hanya jelas di Dark Mode)
                const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
                if (isDark) {
                    card.style.boxShadow = `0 0 ${blur}px rgba(216, 27, 96, ${0.2 + (0.3 * progress)})`;
                    card.style.borderColor = `rgba(216, 27, 96, ${progress})`;
                } else {
                    card.style.boxShadow = `0 ${4 * progress}px ${blur + 5}px rgba(0, 0, 0, 0.1)`;
                    card.style.borderColor = `rgba(142, 36, 170, ${progress})`;
                }

                // Tambah class active untuk z-index sahaja
                if (distanceFromCenter < 50) {
                    card.classList.add('active');
                } else {
                    card.classList.remove('active');
                }
            } else {
                card.style.transform = `scale(1)`;
                card.style.boxShadow = '';
                card.style.borderColor = '';
                card.classList.remove('active');
            }
        });
        requestAnimationFrame(updateActiveCard);
    }

    if (marqueeCards.length > 0) {
        updateActiveCard();
    }
});
