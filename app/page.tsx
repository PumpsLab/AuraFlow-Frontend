import { SiteBanner } from "@/components/landing/SiteBanner";
import { Navbar } from "@/components/landing/Navbar";
import { Hero } from "@/components/landing/Hero";
import { Features } from "@/components/landing/Features";
import { FAQ } from "@/components/landing/FAQ";
import { Footer } from "@/components/landing/Footer";

export default function Home() {
    return (
        <main className="min-h-screen bg-[#000] text-[#faf8f5] selection:bg-[#0098F5]/30 selection:text-white" data-theme-variant="black">
            <div className="relative z-10">
                <SiteBanner />
                <Navbar />
                <Hero />
                <Features />
                <FAQ />
                <Footer />
            </div>
        </main>
    );
}
