import React from 'react';
import { BaseHeaderLayout, ContentLayout, Box, Typography } from '@strapi/design-system';

const App = () => {
  return (
    <>
      <BaseHeaderLayout 
        title="Order Management" 
        subtitle="Manage your customer orders" 
        as="h2" 
      />
      <ContentLayout>
        <Box padding={8} background="neutral100">
          <Typography variant="alpha">Welcome to Order Management!</Typography>
          <Typography variant="beta">Your custom orders dashboard is now loading.</Typography>
          <Typography variant="pi">
            This is a simple test page to verify the plugin is working correctly.
          </Typography>
        </Box>
      </ContentLayout>
    </>
  );
};

export default App;
