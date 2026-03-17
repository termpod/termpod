import { Header } from "./components/Header";
import { Hero } from "./components/sections/Hero";
import { Features } from "./components/sections/Features";
import { UseCases } from "./components/sections/UseCases";
import { Pricing } from "./components/sections/Pricing";
import { OpenSource } from "./components/sections/OpenSource";
import { FinalCTA } from "./components/sections/FinalCTA";
import { Divider } from "./components/Divider";
import { Footer } from "./components/Footer";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <Hero />
      <Divider />
      <Features />
      <Divider />
      <UseCases />
      <Divider />
      <Pricing />
      <Divider />
      <OpenSource />
      <Divider />
      <FinalCTA />
      <Divider />
      <Footer />
    </div>
  );
}
