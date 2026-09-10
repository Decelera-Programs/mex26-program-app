import { motion as Motion } from "framer-motion";
import Loader from "./Loader";

// Full-height centred loader. The optional `message` fades in a beat after the
// mark so a slow screen reads as "working on it", not "stuck".
const LoadingState = ({ message }) => {
  return (
    <div className="flex flex-col items-center justify-center w-full h-[75vh]">
      <div className="flex flex-col items-center gap-4">
        <Loader size={100} />
        {message ? (
          <Motion.p
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
            style={{
              margin: 0,
              fontSize: 12.5,
              fontWeight: 500,
              letterSpacing: "0.04em",
              color: "#6E7892",
            }}
          >
            {message}
          </Motion.p>
        ) : null}
      </div>
    </div>
  );
};

export default LoadingState;
