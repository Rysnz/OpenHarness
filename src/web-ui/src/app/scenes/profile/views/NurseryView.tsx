import React from 'react';
import { useNurseryStore } from '../nurseryStore';
import NurseryGallery from './NurseryGallery';
import TemplateConfigPage from './TemplateConfigPage';
import PartnerConfigPage from './PartnerConfigPage';
import './NurseryView.scss';

const NurseryView: React.FC = () => {
  const { page } = useNurseryStore();

  if (page === 'template') {
    return <TemplateConfigPage />;
  }

  if (page === 'partner') {
    return <PartnerConfigPage />;
  }

  return <NurseryGallery />;
};

export default NurseryView;
