// ============================================
// RASUMI GROUP — ANIMATIONS JS
// Handles: IntersectionObserver scroll reveals,
//          network grid card animation
// ============================================

document.addEventListener('DOMContentLoaded', () => {

    // --- Scroll Reveal (IntersectionObserver) ---
    const scrollContainer = document.querySelector('.scroll-container');

    if (scrollContainer) {
        const observerOptions = {
            root: scrollContainer,
            threshold: 0.1
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }
            });
        }, observerOptions);

        document.querySelectorAll('.service-card, .team-card, .about-content').forEach(el => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(30px)';
            el.style.transition = 'all 0.6s ease-out';
            observer.observe(el);
        });
    }

    // --- Network Grid Card Animation ---
    const grid = document.querySelector('.network-grid');
    if (!grid) return;

    const cards = Array.from(grid.children);
    let isPaused = false;
    let progress = 0;
    const speed = 0.0005;

    // Define 8 anchor points for the 2x4 grid [x, y] in percentage
    const points = [
        { x: 0,  y: 0  },  // Slot 0 (Top-Left)
        { x: 25, y: 0  },  // Slot 1
        { x: 50, y: 0  },  // Slot 2
        { x: 75, y: 0  },  // Slot 3 (Top-Right)
        { x: 75, y: 33 },  // Slot 4 (Bottom-Right)
        { x: 50, y: 33 },  // Slot 5
        { x: 25, y: 33 },  // Slot 6
        { x: 0,  y: 33 }   // Slot 7 (Bottom-Left)
    ];

    function animate() {
        if (!isPaused) {
            progress += speed;
            if (progress >= 1) progress = 0;

            cards.forEach((card, i) => {
                const currentPos = (i + (progress * 8)) % 8;
                const index = Math.floor(currentPos);
                const nextIndex = (index + 1) % 8;
                const factor = currentPos - index;

                const x = points[index].x + (points[nextIndex].x - points[index].x) * factor;
                const y = points[index].y + (points[nextIndex].y - points[index].y) * factor;

                card.style.left = `${x}%`;
                card.style.top = `${y * 4}px`;

                if (y < 10) {
                    card.classList.add('in-top-row');
                } else {
                    card.classList.remove('in-top-row');
                }
            });
        }
        requestAnimationFrame(animate);
    }

    // Pause on hover
    grid.addEventListener('mouseenter', () => isPaused = true);
    grid.addEventListener('mouseleave', () => isPaused = false);

    // Start animation
    animate();
});

// ============================================
// MARQUEE CARD — CENTER SCALE + NEON GLOW
// ============================================
(function initMarqueeScaleEffect() {

    const container = document.querySelector('.scroll-container');
    const marqueeContainer = document.querySelector('.marquee-container');

    if (!marqueeContainer || !container) return;

    function updateCardScales() {
        const cards = document.querySelectorAll('.marquee-card');
        if (!cards.length) return;

        const screenCenterX = window.innerWidth / 2;

        cards.forEach(card => {
            const rect = card.getBoundingClientRect();
            const cardCenterX = rect.left + rect.width / 2;

            // Distance from screen center (0 = perfect center)
            const distance = Math.abs(screenCenterX - cardCenterX);

            // Area in pixels from center where scale stays at maximum (1.15)
            // 160px width allows 2 cards to be at max scale simultaneously
            const peakWidth = 160; 

            // Max influence distance — half screen width
            const maxDistance = window.innerWidth / 2;

            let ratio;
            if (distance <= peakWidth) {
                // If inside the peak zone, ratio is 1 (max scale)
                ratio = 1;
            } else {
                // Outside peak zone: ratio decays from 1 to 0
                ratio = Math.max(0, 1 - (distance - peakWidth) / (maxDistance - peakWidth));
            }

            // Scale: 1.0 (edge) → 1.15 (center/peak zone)
            const scale = 1 + (0.15 * ratio);

            // Neon glow intensity: 0 (edge) → full (center)
            const glowOpacity = ratio;
            const glowBlur = Math.round(ratio * 30);
            const glowSpread = Math.round(ratio * 10);

            card.style.transform = `scale(${scale.toFixed(3)})`;
            card.style.zIndex = Math.round(ratio * 10);

            if (glowOpacity > 0.05) {
                card.style.boxShadow = `
                    0 0 ${glowBlur}px rgba(142, 36, 170, ${(glowOpacity * 0.6).toFixed(3)}),
                    0 0 ${glowSpread}px rgba(194, 0, 120, ${(glowOpacity * 0.4).toFixed(3)}),
                    0 ${Math.round(ratio * 15)}px ${Math.round(ratio * 30)}px rgba(0,0,0,${(ratio * 0.2).toFixed(3)})
                `;
            } else {
                card.style.boxShadow = 'none';
            }
        });
    }

    // Run on every animation frame for smooth effect
    let rafId = null;
    let isVisible = false;

    function loop() {
        if (!isVisible) return;
        updateCardScales();
        rafId = requestAnimationFrame(loop);
    }

    // Start loop only when specialists section is visible
    const specialistsSection = document.querySelector('#specialists');
    if (specialistsSection) {
        const sectionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    isVisible = true;
                    if (!rafId) rafId = requestAnimationFrame(loop);
                } else {
                    isVisible = false;
                    if (rafId) {
                        cancelAnimationFrame(rafId);
                        rafId = null;
                    }
                }
            });
        }, { threshold: 0.2 });

        sectionObserver.observe(specialistsSection);
    }

})();
