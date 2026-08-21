// The drawing vocabulary (D-IL12). One file per primitive — never inlined into an entity, because a
// shape that lives inside one entity is a shape the next entity redraws slightly differently.

export { CalloutCard, calloutCardHeight, CARD_PADDING, CARD_RADIUS } from "./CalloutCard.js";
export { CalibrationCube } from "./CalibrationCube.js";
export { Connector, arrowHeadPoints } from "./Connector.js";
export { ConstructionGhost } from "./ConstructionGhost.js";
export { EntityRoot, entityPortAnchors } from "./EntityRoot.js";
export { FIGURE_PROPORTIONS, IsoFigure, figureBoxes, figureHeightUnits } from "./IsoFigure.js";
export { GlyphFrame, resolveGlyphFace } from "./GlyphFrame.js";
export { IsoHousing, isoExtrude } from "./IsoHousing.js";
export {
  IsoSheetStack,
  SHEET_STACK_GAP_FRACTION,
  sheetStackBoxes,
} from "./IsoSheetStack.js";
export {
  IsoPlatform,
  PLATFORM_MAX_TIERS,
  PLATFORM_TIER_HEIGHTS,
  PLATFORM_TIER_INSET,
  platformHeight,
} from "./IsoPlatform.js";
export { TRACK_LANE, IsoTrack, TrackMarks, trackLaneBox } from "./IsoTrack.js";
export { PaperStage } from "./PaperStage.js";
export { PrincipleCard, principleCardHeight } from "./PrincipleCard.js";
export { StationHeader } from "./StationHeader.js";
export {
  DEFAULT_ENTITY_FRAME,
  EntityFrameContext,
  useEntityFrame,
} from "./entity-frame.js";

export type { CalloutCardProps } from "./CalloutCard.js";
export type { CalibrationCubeProps } from "./CalibrationCube.js";
export type { ConnectorProps } from "./Connector.js";
export type { ConstructionGhostProps } from "./ConstructionGhost.js";
export type { EntityMeta, EntityRootProps } from "./EntityRoot.js";
export type { GlyphFace, GlyphFrameProps } from "./GlyphFrame.js";
export type { FigureBoxes, IsoFigureProps } from "./IsoFigure.js";
export type { IsoHousingProps } from "./IsoHousing.js";
export type { IsoTrackProps, TrackLaneOptions, TrackMarksProps } from "./IsoTrack.js";
export type { IsoPlatformProps } from "./IsoPlatform.js";
export type {
  IsoSheetStackProps,
  SheetStackGeometry,
  SheetStackOptions,
} from "./IsoSheetStack.js";
export type { PaperStageProps } from "./PaperStage.js";
export type { PrincipleCardProps } from "./PrincipleCard.js";
export type { StationHeaderProps } from "./StationHeader.js";
export type { EntityFrame } from "./entity-frame.js";
