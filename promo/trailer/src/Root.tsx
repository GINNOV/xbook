import "./index.css";
import { Composition } from "remotion";
import { TRAILER_DURATION, XBookTrailer } from "./XBookTrailer";
import { VIDEO } from "./theme";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="XBookTrailer"
        component={XBookTrailer}
        durationInFrames={TRAILER_DURATION}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
        defaultProps={{}}
      />
    </>
  );
};
