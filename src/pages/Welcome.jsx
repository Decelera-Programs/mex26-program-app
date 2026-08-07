import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion as Motion } from "framer-motion";

export default function Welcome() {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate("/home");
    }, 3000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="min-h-dvh bg-white text-[#1fd0ef] flex flex-col items-center justify-center px-8 relative overflow-hidden">
      <div className="absolute top-20 left-10 w-64 h-64 rounded-full bg-[#1fd0ef]/10 blur-xl" />
      <div className="absolute bottom-20 right-10 w-48 h-48 rounded-full bg-[#1fd0ef]/10 blur-xl" />
      <div className="absolute top-1/3 right-20 w-32 h-32 rounded-full bg-[#1fd0ef]/15 blur-lg" />

      <Motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="relative z-10 text-center"
      >
        <Motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="w-28 h-28 mx-auto mb-8 rounded-3xl bg-white border border-[#1fd0ef]/20 flex items-center justify-center shadow-xl shadow-[#1fd0ef]/10"
        >
          <img
            src="/android-chrome-192x192.png"
            alt="Company logo"
            className="w-20 h-20 object-contain"
          />
        </Motion.div>

        <Motion.h1
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="text-4xl font-bold text-[#1fd0ef] font-display leading-tight"
        >
          Welcome to
          <br />
          <span className="text-[#1fd0ef]">Menorca 2026</span>
        </Motion.h1>

        <Motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="text-[#1fd0ef]/80 text-sm mt-4 tracking-wide"
        >
          Startup Bootcamp
        </Motion.p>

        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2, duration: 0.5 }}
          className="mt-16 flex items-center justify-center gap-2"
        >
          <div className="w-1.5 h-1.5 rounded-full bg-[#1fd0ef]/50 animate-pulse" style={{ animationDelay: "0ms" }} />
          <div className="w-1.5 h-1.5 rounded-full bg-[#1fd0ef]/50 animate-pulse" style={{ animationDelay: "300ms" }} />
          <div className="w-1.5 h-1.5 rounded-full bg-[#1fd0ef]/50 animate-pulse" style={{ animationDelay: "600ms" }} />
        </Motion.div>
      </Motion.div>
    </div>
  );
}

