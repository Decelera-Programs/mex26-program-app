import React from 'react';
import Loader from './Loader';

const LoadingState = () => {
  return (
    /* Cambiamos py-20 por flex-1 y h-[70vh] para forzar el centro vertical */
    <div className="flex flex-col items-center justify-center w-full h-[75vh]">
      <div className="flex flex-col items-center">
        {/* Tu logo animado */}
        <Loader size={100} />
      </div>
    </div>
  );
};

export default LoadingState;