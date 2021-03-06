/**
 * @license
 * Copyright (C) 2016 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import '../../shared/gr-cursor-manager/gr-cursor-manager';
import {GrCursorManager} from '../../shared/gr-cursor-manager/gr-cursor-manager';
import {afterNextRender} from '@polymer/polymer/lib/utils/render-status';
import {dom} from '@polymer/polymer/lib/legacy/polymer.dom';
import {GestureEventListeners} from '@polymer/polymer/lib/mixins/gesture-event-listeners';
import {LegacyElementMixin} from '@polymer/polymer/lib/legacy/legacy-element-mixin';
import {PolymerElement} from '@polymer/polymer/polymer-element';
import {htmlTemplate} from './gr-diff-cursor_html';
import {ScrollMode} from '../../../constants/constants';
import {customElement, property, observe} from '@polymer/decorators';
import {DiffSide} from '../gr-diff/gr-diff-utils';
import {GrDiffLineType} from '../gr-diff/gr-diff-line';
import {PolymerSpliceChange} from '@polymer/polymer/interfaces';
import {PolymerDomWrapper} from '../../../types/types';
import {GrDiffGroupType} from '../gr-diff/gr-diff-group';

const DiffViewMode = {
  SIDE_BY_SIDE: 'SIDE_BY_SIDE',
  UNIFIED: 'UNIFIED_DIFF',
};

type GrDiffRowType = GrDiffLineType | GrDiffGroupType;

const LEFT_SIDE_CLASS = 'target-side-left';
const RIGHT_SIDE_CLASS = 'target-side-right';

// TODO(TS): Use proper GrDiff type once that file is converted to TS.
interface GrDiff extends HTMLElement {
  path: string;
  addDraftAtLine: (element: HTMLElement) => void;
  createRangeComment: () => void;
  getCursorStops: () => HTMLElement[];
  isRangeSelected: () => boolean;
}

export interface GrDiffCursor {
  $: {
    cursorManager: GrCursorManager;
  };
}

@customElement('gr-diff-cursor')
export class GrDiffCursor extends GestureEventListeners(
  LegacyElementMixin(PolymerElement)
) {
  static get template() {
    return htmlTemplate;
  }

  private _boundHandleWindowScroll: () => void;

  private _boundHandleDiffRenderStart: () => void;

  private _boundHandleDiffRenderContent: () => void;

  private _boundHandleDiffLineSelected: (e: Event) => void;

  private _preventAutoScrollOnManualScroll = false;

  @property({type: String})
  side = DiffSide.RIGHT;

  @property({type: Object, notify: true, observer: '_rowChanged'})
  diffRow?: HTMLElement;

  @property({type: Object})
  diffs: GrDiff[] = [];

  /**
   * If set, the cursor will attempt to move to the line number (instead of
   * the first chunk) the next time the diff renders. It is set back to null
   * when used. It should be only used if you want the line to be focused
   * after initialization of the component and page should scroll
   * to that position. This parameter should be set at most for one gr-diff
   * element in the page.
   */
  @property({type: Number})
  initialLineNumber: number | null = null;

  /**
   * The scroll behavior for the cursor. Values are 'never' and
   * 'keep-visible'. 'keep-visible' will only scroll if the cursor is beyond
   * the viewport.
   */
  @property({type: String})
  _scrollMode = ScrollMode.KEEP_VISIBLE;

  @property({type: Boolean})
  _focusOnMove = true;

  @property({type: Boolean})
  _listeningForScroll = false;

  constructor() {
    super();
    this._boundHandleWindowScroll = () => this._handleWindowScroll();
    this._boundHandleDiffRenderStart = () => this._handleDiffRenderStart();
    this._boundHandleDiffRenderContent = () => this._handleDiffRenderContent();
    this._boundHandleDiffLineSelected = (e: Event) =>
      this._handleDiffLineSelected(e);
  }

  /** @override */
  ready() {
    super.ready();
    afterNextRender(this, () => {
      /*
      This represents the diff cursor is ready for interaction coming from
      client components. It is more then Polymer "ready" lifecycle, as no
      "ready" events are automatically fired by Polymer, it means
      the cursor is completely interactable - in this case attached and
      painted on the page. We name it "ready" instead of "rendered" as the
      long-term goal is to make gr-diff-cursor a javascript class - not a DOM
      element with an actual lifecycle. This will be triggered only once
      per element.
      */
      this.dispatchEvent(
        new CustomEvent('ready', {
          composed: true,
          bubbles: false,
        })
      );
    });
  }

  /** @override */
  connectedCallback() {
    super.connectedCallback();
    // Catch when users are scrolling as the view loads.
    window.addEventListener('scroll', this._boundHandleWindowScroll);
  }

  /** @override */
  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('scroll', this._boundHandleWindowScroll);
  }

  moveLeft() {
    this.side = DiffSide.LEFT;
    if (this._isTargetBlank()) {
      this.moveUp();
    }
  }

  moveRight() {
    this.side = DiffSide.RIGHT;
    if (this._isTargetBlank()) {
      this.moveUp();
    }
  }

  moveDown() {
    if (this._getViewMode() === DiffViewMode.SIDE_BY_SIDE) {
      this.$.cursorManager.next(this._rowHasSide.bind(this));
    } else {
      this.$.cursorManager.next();
    }
  }

  moveUp() {
    if (this._getViewMode() === DiffViewMode.SIDE_BY_SIDE) {
      this.$.cursorManager.previous(this._rowHasSide.bind(this));
    } else {
      this.$.cursorManager.previous();
    }
  }

  moveToVisibleArea() {
    if (this._getViewMode() === DiffViewMode.SIDE_BY_SIDE) {
      this.$.cursorManager.moveToVisibleArea(this._rowHasSide.bind(this));
    } else {
      this.$.cursorManager.moveToVisibleArea();
    }
  }

  moveToNextChunk(clipToTop?: boolean, navigateToNextFile?: boolean) {
    this.$.cursorManager.next(
      this._isFirstRowOfChunk.bind(this),
      target => (target?.parentNode as HTMLElement)?.scrollHeight || 0,
      clipToTop,
      navigateToNextFile
    );
    this._fixSide();
  }

  moveToPreviousChunk() {
    this.$.cursorManager.previous(this._isFirstRowOfChunk.bind(this));
    this._fixSide();
  }

  moveToNextCommentThread() {
    this.$.cursorManager.next(this._rowHasThread.bind(this));
    this._fixSide();
  }

  moveToPreviousCommentThread() {
    this.$.cursorManager.previous(this._rowHasThread.bind(this));
    this._fixSide();
  }

  moveToLineNumber(number: number, side: DiffSide, path?: string) {
    const row = this._findRowByNumberAndFile(number, side, path);
    if (row) {
      this.side = side;
      this.$.cursorManager.setCursor(row);
    }
  }

  /**
   * Get the line number element targeted by the cursor row and side.
   */
  getTargetLineElement(): HTMLElement | null {
    let lineElSelector = '.lineNum';

    if (!this.diffRow) {
      return null;
    }

    if (this._getViewMode() === DiffViewMode.SIDE_BY_SIDE) {
      lineElSelector += this.side === DiffSide.LEFT ? '.left' : '.right';
    }

    return this.diffRow.querySelector(lineElSelector);
  }

  getTargetDiffElement(): GrDiff | null {
    if (!this.diffRow) return null;

    const hostOwner = (dom(this.diffRow) as PolymerDomWrapper).getOwnerRoot();
    if (hostOwner?.host?.tagName === 'GR-DIFF') {
      return hostOwner.host as GrDiff;
    }
    return null;
  }

  moveToFirstChunk() {
    this.$.cursorManager.moveToStart();
    this.moveToNextChunk(true);
  }

  moveToLastChunk() {
    this.$.cursorManager.moveToEnd();
    this.moveToPreviousChunk();
  }

  /**
   * Move the cursor either to initialLineNumber or the first chunk and
   * reset scroll behavior.
   *
   * This may grab the focus from the app.
   *
   * If you do not want to move the cursor or grab focus, and just want to
   * reset the scroll behavior, use reInit() instead.
   */
  reInitCursor() {
    if (!this.diffRow) {
      // does not scroll during init unless requested
      this._scrollMode = this.initialLineNumber
        ? ScrollMode.KEEP_VISIBLE
        : ScrollMode.NEVER;
      if (this.initialLineNumber) {
        this.moveToLineNumber(this.initialLineNumber, this.side);
        this.initialLineNumber = null;
      } else {
        this.moveToFirstChunk();
      }
    }
    this.reInit();
  }

  reInit() {
    this._scrollMode = ScrollMode.KEEP_VISIBLE;
  }

  _handleWindowScroll() {
    if (this._preventAutoScrollOnManualScroll) {
      this._scrollMode = ScrollMode.NEVER;
      this._focusOnMove = false;
      this._preventAutoScrollOnManualScroll = false;
    }
  }

  reInitAndUpdateStops() {
    this.reInit();
    this._updateStops();
  }

  handleDiffUpdate() {
    this._updateStops();
    this.reInitCursor();
  }

  _handleDiffRenderStart() {
    this._preventAutoScrollOnManualScroll = true;
  }

  _handleDiffRenderContent() {
    this._updateStops();
    // When done rendering, turn focus on move and automatic scrolling back on
    this._focusOnMove = true;
    this._preventAutoScrollOnManualScroll = false;
  }

  _handleDiffLineSelected(event: Event) {
    const customEvent = event as CustomEvent;
    this.moveToLineNumber(
      customEvent.detail.number,
      customEvent.detail.side,
      customEvent.detail.path
    );
  }

  createCommentInPlace() {
    const diffWithRangeSelected = this.diffs.find(diff =>
      diff.isRangeSelected()
    );
    if (diffWithRangeSelected) {
      diffWithRangeSelected.createRangeComment();
    } else {
      const line = this.getTargetLineElement();
      const diff = this.getTargetDiffElement();
      if (diff && line) {
        diff.addDraftAtLine(line);
      }
    }
  }

  /**
   * Get an object describing the location of the cursor. Such as
   * {leftSide: false, number: 123} for line 123 of the revision, or
   * {leftSide: true, number: 321} for line 321 of the base patch.
   * Returns null if an address is not available.
   *
   * @return
   */
  getAddress() {
    if (!this.diffRow) {
      return null;
    }

    // Get the line-number cell targeted by the cursor. If the mode is unified
    // then prefer the revision cell if available.
    let cell;
    if (this._getViewMode() === DiffViewMode.UNIFIED) {
      cell = this.diffRow.querySelector('.lineNum.right');
      if (!cell) {
        cell = this.diffRow.querySelector('.lineNum.left');
      }
    } else {
      cell = this.diffRow.querySelector('.lineNum.' + this.side);
    }
    if (!cell) {
      return null;
    }

    const number = cell.getAttribute('data-value');
    if (!number || number === 'FILE') {
      return null;
    }

    return {
      leftSide: cell.matches('.left'),
      number: parseInt(number, 10),
    };
  }

  _getViewMode() {
    if (!this.diffRow) {
      return null;
    }

    if (this.diffRow.classList.contains('side-by-side')) {
      return DiffViewMode.SIDE_BY_SIDE;
    } else {
      return DiffViewMode.UNIFIED;
    }
  }

  _rowHasSide(row: Element) {
    const selector =
      (this.side === DiffSide.LEFT ? '.left' : '.right') + ' + .content';
    return !!row.querySelector(selector);
  }

  _isFirstRowOfChunk(row: HTMLElement) {
    const parentClassList = (row.parentNode as HTMLElement).classList;
    return (
      parentClassList.contains('section') &&
      parentClassList.contains('delta') &&
      !row.previousSibling
    );
  }

  _rowHasThread(row: HTMLElement) {
    return row.querySelector('.thread-group');
  }

  /**
   * If we jumped to a row where there is no content on the current side then
   * switch to the alternate side.
   */
  _fixSide() {
    if (
      this._getViewMode() === DiffViewMode.SIDE_BY_SIDE &&
      this._isTargetBlank()
    ) {
      this.side = this.side === DiffSide.LEFT ? DiffSide.RIGHT : DiffSide.LEFT;
    }
  }

  _isTargetBlank() {
    if (!this.diffRow) {
      return false;
    }

    const actions = this._getActionsForRow();
    return (
      (this.side === DiffSide.LEFT && !actions.left) ||
      (this.side === DiffSide.RIGHT && !actions.right)
    );
  }

  _rowChanged(_: HTMLElement, oldRow: HTMLElement) {
    if (oldRow) {
      oldRow.classList.remove(LEFT_SIDE_CLASS, RIGHT_SIDE_CLASS);
    }
    this._updateSideClass();
  }

  @observe('side')
  _updateSideClass() {
    if (!this.diffRow) {
      return;
    }
    this.toggleClass(
      LEFT_SIDE_CLASS,
      this.side === DiffSide.LEFT,
      this.diffRow
    );
    this.toggleClass(
      RIGHT_SIDE_CLASS,
      this.side === DiffSide.RIGHT,
      this.diffRow
    );
  }

  _isActionType(type: GrDiffRowType) {
    return (
      type !== GrDiffLineType.BLANK && type !== GrDiffGroupType.CONTEXT_CONTROL
    );
  }

  _getActionsForRow() {
    const actions = {left: false, right: false};
    if (this.diffRow) {
      actions.left = this._isActionType(
        this.diffRow.getAttribute('left-type') as GrDiffRowType
      );
      actions.right = this._isActionType(
        this.diffRow.getAttribute('right-type') as GrDiffRowType
      );
    }
    return actions;
  }

  _getStops() {
    return this.diffs.reduce(
      (stops: HTMLElement[], diff) => stops.concat(diff.getCursorStops()),
      []
    );
  }

  _updateStops() {
    this.$.cursorManager.stops = this._getStops();
  }

  /**
   * Setup and tear down on-render listeners for any diffs that are added or
   * removed from the cursor.
   */
  @observe('diffs.splices')
  _diffsChanged(changeRecord: PolymerSpliceChange<GrDiff[]>) {
    if (!changeRecord) {
      return;
    }

    this._updateStops();

    let splice;
    let i;
    for (
      let spliceIdx = 0;
      changeRecord.indexSplices && spliceIdx < changeRecord.indexSplices.length;
      spliceIdx++
    ) {
      splice = changeRecord.indexSplices[spliceIdx];

      // Removals must come before additions, because the gr-diff instances
      // might be the same.
      for (i = 0; i < splice?.removed.length; i++) {
        splice.removed[i].removeEventListener(
          'render-start',
          this._boundHandleDiffRenderStart
        );
        splice.removed[i].removeEventListener(
          'render-content',
          this._boundHandleDiffRenderContent
        );
        splice.removed[i].removeEventListener(
          'line-selected',
          this._boundHandleDiffLineSelected
        );
      }

      for (i = splice.index; i < splice.index + splice.addedCount; i++) {
        this.diffs[i].addEventListener(
          'render-start',
          this._boundHandleDiffRenderStart
        );
        this.diffs[i].addEventListener(
          'render-content',
          this._boundHandleDiffRenderContent
        );
        this.diffs[i].addEventListener(
          'line-selected',
          this._boundHandleDiffLineSelected
        );
      }
    }
  }

  _findRowByNumberAndFile(
    targetNumber: number,
    side: DiffSide,
    path?: string
  ): HTMLElement | undefined {
    let stops;
    if (path) {
      const diff = this.diffs.filter(diff => diff.path === path)[0];
      stops = diff.getCursorStops();
    } else {
      stops = this.$.cursorManager.stops;
    }
    let selector;
    for (let i = 0; i < stops.length; i++) {
      selector = `.lineNum.${side}[data-value="${targetNumber}"]`;
      if (stops[i].querySelector(selector)) {
        return stops[i];
      }
    }
    return undefined;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'gr-diff-cursor': GrDiffCursor;
  }
}
