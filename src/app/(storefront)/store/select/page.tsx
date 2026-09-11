import type { Metadata } from 'next';
import { CommunitySelector } from '../../community-selector';

export const metadata: Metadata = {
  title: 'Select Store Community | Munder Fresh',
  description: 'Choose your residential community for scheduled fresh grocery delivery.',
};

export default function StoreSelectPage(): React.ReactElement {
  return (
    <div className="py-4 sm:py-8 max-w-4xl mx-auto">
      <CommunitySelector />
    </div>
  );
}
