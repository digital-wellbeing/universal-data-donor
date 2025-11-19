import React from 'react';
import { Box, Container, Typography, Card, CardContent, CardActionArea, Grid, Button } from '@mui/material';
import './PlatformSelector.css';

const PlatformSelector = ({ onSelectPlatform }) => {
  const platforms = [
    {
      id: 'playstation',
      name: 'PlayStation',
      logo: '/playstation-svgrepo-com.svg',
      description: 'Donate your PlayStation gaming data',
      color: '#003791'
    },
    {
      id: 'android',
      name: 'Google Play Games',
      logo: '/android-logo.svg',
      description: 'Donate your Google Play Games data',
      color: '#3DDC84'
    }
  ];

  const handlePlatformClick = (platformId) => {
    // Update URL with platform parameter
    const url = new URL(window.location);
    url.searchParams.set('platform', platformId);
    window.history.pushState({}, '', url);

    // Notify parent component
    onSelectPlatform(platformId);
  };

  return (
    <Box className="platform-selector-wrapper">
      <Container maxWidth="lg" className="platform-selector-container">
        <Box sx={{ textAlign: 'center', mb: 6 }}>
          <Typography variant="h2" component="h1" className="platform-selector-title">
            Universal Data Donor
          </Typography>
          <Typography variant="h5" className="platform-selector-subtitle">
            Select the platform you want to donate data from
          </Typography>
        </Box>

        <Grid container spacing={4} justifyContent="center">
          {platforms.map((platform) => (
            <Grid item xs={12} sm={6} md={5} key={platform.id}>
              <Card
                className="platform-card"
                sx={{
                  height: '100%',
                  borderRadius: 2,
                  border: `3px solid ${platform.color}`,
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    transform: 'translateY(-10px)',
                    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
                  }
                }}
              >
                <CardActionArea
                  onClick={() => handlePlatformClick(platform.id)}
                  sx={{ height: '100%' }}
                >
                  <CardContent
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      textAlign: 'center',
                      p: 5,
                      height: '100%'
                    }}
                  >
                    <Box className="platform-logo-container" sx={{ mb: 3 }}>
                      <img
                        src={process.env.PUBLIC_URL + platform.logo}
                        alt={`${platform.name} Logo`}
                        className="platform-logo"
                        style={{ filter: `drop-shadow(0 4px 8px ${platform.color}33)` }}
                      />
                    </Box>
                    <Typography
                      variant="h4"
                      component="h2"
                      className="platform-name"
                      sx={{ color: platform.color, mb: 2 }}
                    >
                      {platform.name}
                    </Typography>
                    <Typography
                      variant="body1"
                      color="text.secondary"
                      className="platform-description"
                      sx={{ mb: 3, flex: 1 }}
                    >
                      {platform.description}
                    </Typography>
                    <Button
                      variant="contained"
                      size="large"
                      fullWidth
                      className="platform-select-btn"
                      sx={{
                        backgroundColor: platform.color,
                        '&:hover': {
                          backgroundColor: platform.color,
                          transform: 'scale(1.05)',
                        }
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlatformClick(platform.id);
                      }}
                    >
                      Select {platform.name}
                    </Button>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Box sx={{ textAlign: 'center', mt: 5 }}>
          <Typography variant="body2" color="text.secondary">
            <strong>Tip:</strong> You can also access a specific platform directly using URL parameters:
            <br />
            <code>?platform=playstation</code> or <code>?platform=android</code>
          </Typography>
        </Box>
      </Container>
    </Box>
  );
};

export default PlatformSelector;
