import {ForkBuilderBase} from "./makebrew-forkbase.js";
import {BuilderUi} from "./makebrew-builderui.js";

/**
 * A builder for languages.
 *
 * The smallest entity in the data, and the one a table invents most often — every setting has its
 * own tongues. There is nothing to compute: a language is a name, what kind it is, who speaks it,
 * and what it is written in. The reason to build it here rather than write the JSON by hand is that
 * the character builder's language pickers read the *list*, so a language that exists as a file
 * nobody indexed is a language nobody can choose.
 */

/** `type` as the data uses it. A language with none is simply unclassified, so it stays nullable. */
const _TYPES = ["standard", "rare", "exotic", "secret"];

export class LanguageBuilder extends ForkBuilderBase {
	constructor () {
		super({
			prop: "language",
			pFnGetFluff: Renderer.language.pGetFluff.bind(Renderer.language),
		});

		this._renderOutputDebounced = MiscUtil.debounce(() => this._renderOutput(), 50);
	}

	async pHandleClickLoadExisting () {
		// Languages have no ready-made search widget upstream, so index them the way the feat and
		// background ones do
		await SearchWidget.pLoadCustomIndex({
			contentIndexName: "entity_Languages",
			errorName: "languages",
			customIndexSubSpecs: [
				new SearchWidget.CustomIndexSubSpec({
					dataSource: `${Renderer.get().baseUrl}data/languages.json`,
					prop: "language",
					catId: Parser.CAT_ID_LANGUAGE,
					page: UrlUtil.PG_LANGUAGES,
				}),
			],
		});

		const result = await SearchWidget.pGetUserEntitySearch(
			"Select Language",
			"entity_Languages",
			{
				fnTransform: doc => {
					const cpy = MiscUtil.copyFast(doc);
					Object.assign(cpy, SearchWidget.docToPageSourceHash(cpy));
					cpy.tag = `{@language ${doc.n}${doc.s !== Parser.SRC_PHB ? `|${doc.s}` : ""}}`;
					return cpy;
				},
			},
		);
		if (!result) return;

		const language = MiscUtil.copy(await DataLoader.pCacheAndGet(result.page, result.source, result.hash));
		return this.pHandleLoadExistingData(language);
	}

	_getInitialState () {
		return {
			...super._getInitialState(),
			name: "New Language",
			type: "standard",
			source: this._ui ? this._ui.source : "",
		};
	}

	/* -------------------------------------------- */

	_renderInputMain () {
		this._adoptUiSource();

		const wrp = this._ui.wrpInput.vee.empty();
		const cb = this._getRenderCallback();
		const [infoTab, textTab] = this._renderForkInputTabs({wrp, names: ["Info", "Text"]});

		// ---------- INFO ----------
		BuilderUi.getStateIptString("Name", cb, this._state, {nullable: false}, "name").vee.appendTo(infoTab.wrpTab);
		this._selSource = this.getSourceInput(cb).vee.appendTo(infoTab.wrpTab);
		BuilderUi.getStateIptString("Page", cb, this._state, {type: "number"}, "page").vee.appendTo(infoTab.wrpTab);
		BuilderUi.getStateIptEnum(
			"Type",
			cb,
			this._state,
			{vals: _TYPES, fnDisplay: it => it.toTitleCase(), nullable: true},
			"type",
		).vee.appendTo(infoTab.wrpTab);
		BuilderUi.getStateIptString(
			"Script",
			cb,
			this._state,
			{title: "The alphabet it is written in — Common, Elvish, Dwarvish, or one of your own."},
			"script",
		).vee.appendTo(infoTab.wrpTab);
		BuilderUi.getStateIptString(
			"Origin",
			cb,
			this._state,
			{title: "Where it came from, in a few words. The books use this for the planar tongues."},
			"origin",
		).vee.appendTo(infoTab.wrpTab);
		BuilderUi.getStateIptStringArray(
			"Typical Speakers",
			cb,
			this._state,
			{shortName: "Speaker"},
			"typicalSpeakers",
		).vee.appendTo(infoTab.wrpTab);
		BuilderUi.getStateIptStringArray(
			"Dialects",
			cb,
			this._state,
			{
				shortName: "Dialect",
				title: "Naming dialects makes this language a family; the renderer says as much, and that speakers of different dialects understand each other.",
			},
			"dialects",
		).vee.appendTo(infoTab.wrpTab);

		// ---------- TEXT ----------
		BuilderUi.getStateIptEntries(
			"Text",
			cb,
			this._state,
			{placeholder: "Anything worth saying beyond the fields above. A language needs none — most in the books have none."},
			"entries",
		).vee.appendTo(textTab.wrpTab);
	}

	/* -------------------------------------------- */

	renderOutput () {
		this._renderOutputDebounced();
	}

	_renderOutput () {
		this._renderForkOutput({
			name: "Language",
			fnRender: cpy => Renderer.language.getCompactRenderedString(cpy),
		});
	}
}
