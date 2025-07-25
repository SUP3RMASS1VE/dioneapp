import { useTranslation } from "@renderer/translations/translationContext";
import { openLink } from "@renderer/utils/openLink";

export default function PromoBanner() {
	const { t } = useTranslation();

	return (
		<div className="mt-6 w-full rounded-xl border border-white/5 bg-[#080808]/50 overflow-hidden">
			<div className="relative w-full p-4">
				{/* Background effects - modified */}
				<div className="absolute top-0 left-1/4 md:left-1/3 w-32 h-32 md:w-64 md:h-64 bg-[#BCB1E7] rounded-full -translate-y-1/2 blur-3xl md:blur-[100px] animate-pulse [animation-duration:7000ms]" />
				<div className="absolute bottom-0 right-1/4 md:right-1/3 w-32 h-32 md:w-64 md:h-64 bg-[#BCB1E7] rounded-full translate-y-1/2 blur-3xl md:blur-[100px] animate-pulse [animation-duration:7000ms]" />
				{/* main promo content */}
				<div className="relative flex flex-row items-center justify-between px-6 z-10">
					<div className="flex flex-col space-y-1">
						<h3 className="text-md font-semibold text-white">
							{t("promo.title")}
						</h3>
						<p className="text-[13px] text-neutral-300/80">
							{t("promo.description")}
						</p>
					</div>
					<button
						type="button"
						onClick={() => openLink("https://getdione.app/featured/join")}
						className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-full transition-all duration-300 text-sm font-medium whitespace-nowrap cursor-pointer"
					>
						{t("promo.button")}
					</button>
				</div>
			</div>
		</div>
	);
}
